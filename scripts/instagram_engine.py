#!/usr/bin/env python3
"""
instagram_engine.py — Unified Instagram media downloader & processor for ai-chat.
Standar Produksi & Kualitas V3:
1. Video & Reels (unduh kualitas terbaik + injeksi faststart H.264 untuk web/WA).
2. Foto Tunggal & Carousel (resolusi tinggi).
3. Ekstraksi Audio / Musik Latar bawaan Instagram:
   - Pindai clips_metadata, music_metadata, clips_music_attribution_info, audio_asset_id,
     progressive_download_url, dan stream .m4a.
4. Merger Otomatis (Default): Carousel berlagu dan foto bersuara WAJIB dikonversi jadi
   video MP4 (slideshow) bersuara durasi pas via FFmpeg -movflags +faststart.
5. Smart Audio Query & Cache Check:
   - Jika video hasil merger dengan audio sudah pernah dibuat di /root/ai-chat/uploads/shared/,
     gunakan langsung (cache reuse instan).
   - Mendukung opsi --audio-query / --song untuk mengambil lagu via YouTube jika stream audio
     CDN Instagram disembunyikan/dibatasi pada akses publik tanpa login.
6. Anti-Halusinasi Audio:
   - Validasi ketat volume audio via ffprobe volumedetect (max_volume > -50 dB).
   - Dilarang membuat video silent palsu dengan anullsrc.
7. Multi-Engine Resolver:
   - Jalur 1: instagrapi (private mobile API jika sessionid tersedia)
   - Jalur 2: ScrapingBee API (jalur utama ekstraksi payload publik tanpa login)
   - Jalur 3: Playwright Chromium (network interception & DOM parser)
   - Jalur 4: Resolver publik (SaveIG fallback)
8. Dual-Staging: Otomatis tersedia di:
   - /root/ai-chat/uploads/shared/
   - /root/ai-chat/public/browser-shots/
   - /root/ai-chat/data/downloads/
9. Keluaran: Satu baris JSON murni ke stdout.
"""

import argparse
import asyncio
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

COOKIE_FILE = "/root/.config/yt-dlp/ig_cookies.txt"
DEFAULT_OUT = "/root/ai-chat/data/downloads"
SHARED_DIR = "/root/ai-chat/uploads/shared"
SHOTS_DIR = "/root/ai-chat/public/browser-shots"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

def load_env_local():
    env_local = "/root/ai-chat/.env.local"
    if os.path.exists(env_local):
        try:
            with open(env_local, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip('"\'')
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_env_local()

for d in (DEFAULT_OUT, SHARED_DIR, SHOTS_DIR):
    os.makedirs(d, exist_ok=True)

def emit(data, exit_code=0):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(exit_code)

def extract_shortcode(input_str):
    s = str(input_str or "").strip()
    m = re.search(r"instagram\.com/(?:reel|reels|p|tv|stories)/([A-Za-z0-9_-]+)", s, re.I)
    if m:
        return m.group(1)
    if re.match(r"^[A-Za-z0-9_-]{9,20}$", s):
        return s
    return None

def publish_file(src_path, dest_filename):
    """Pastikan berkas diduplikasi ke direktori staging ai-chat."""
    os.makedirs(DEFAULT_OUT, exist_ok=True)
    out_target = os.path.join(DEFAULT_OUT, dest_filename)
    if os.path.abspath(src_path) != os.path.abspath(out_target):
        try:
            shutil.copy2(src_path, out_target)
        except Exception:
            pass

    for target_dir in (SHARED_DIR, SHOTS_DIR):
        try:
            os.makedirs(target_dir, exist_ok=True)
            p = os.path.join(target_dir, dest_filename)
            if os.path.abspath(src_path) != os.path.abspath(p):
                shutil.copy2(src_path, p)
        except Exception:
            pass
    return os.path.join(SHARED_DIR, dest_filename)

def check_audio_volume(file_path):
    """Memeriksa apakah berkas audio benar-benar bersuara (bukan silent -91 dB)."""
    try:
        cmd = [
            "ffmpeg", "-i", str(file_path),
            "-af", "volumedetect", "-vn", "-sn", "-dn",
            "-f", "null", "/dev/null"
        ]
        res = subprocess.run(cmd, stderr=subprocess.PIPE, text=True)
        m = re.search(r"max_volume:\s*(-?[\d\.]+)\s*dB", res.stderr)
        if m:
            vol = float(m.group(1))
            return vol > -50.0  # Lebih dari -50 dB berarti ada suara riil
    except Exception:
        pass
    return False

def check_existing_merged(shortcode):
    """Cek apakah video hasil merger bersuara sudah pernah dibuat untuk shortcode ini."""
    candidates = [
        os.path.join(SHARED_DIR, f"instagram_{shortcode}_merged.mp4"),
        os.path.join(SHARED_DIR, f"ig_{shortcode}_merged.mp4"),
        os.path.join(SHARED_DIR, f"ig_{shortcode}_slide.mp4"),
        os.path.join(DEFAULT_OUT, f"ig_{shortcode}_merged.mp4"),
        os.path.join(DEFAULT_OUT, f"ig_{shortcode}_slide.mp4"),
    ]
    for c in candidates:
        if os.path.exists(c) and os.path.getsize(c) > 20000:
            if check_audio_volume(c):
                pub = publish_file(c, os.path.basename(c))
                img_paths = sorted(glob.glob(os.path.join(SHARED_DIR, f"ig_{shortcode}_*.jpg")))
                return {
                    "ok": True,
                    "type": "video",
                    "sub_type": "slideshow",
                    "path": pub,
                    "paths": [pub] + img_paths,
                    "shortcode": shortcode,
                    "has_audio": True,
                    "size": os.path.getsize(pub)
                }
    return None

def download_audio_by_query(query, shortcode):
    """Unduh audio lagu via pencarian YouTube yt-dlp."""
    if not query:
        return None
    target_audio = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_query_audio.m4a")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        f"ytsearch1:{query}",
        "-x",
        "--audio-format", "m4a",
        "-o", target_audio,
        "--force-overwrites"
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=40)
        if res.returncode == 0 and os.path.exists(target_audio) and check_audio_volume(target_audio):
            return target_audio
    except Exception:
        pass
    return None

def get_scrapingbee_key():
    """Ambil API key ScrapingBee aktif dari .env.local atau environment."""
    env_local = "/root/ai-chat/.env.local"
    if os.path.exists(env_local):
        try:
            with open(env_local, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("SCRAPINGBEE_API_KEY="):
                        val = line.strip().split("=", 1)[1].strip('"\'')
                        if val:
                            return val
        except Exception:
            pass
    return os.environ.get("SCRAPINGBEE_API_KEY")

def optimize_video(src_path, dst_path):
    """Konversi video ke H.264 Main 4.0 + AAC + faststart agar kompatibel web & HP."""
    cmd = [
        "ffmpeg", "-y", "-i", str(src_path),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "-c:v", "libx264", "-profile:v", "main", "-level", "4.0",
        "-pix_fmt", "yuv420p", "-preset", "fast",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart",
        str(dst_path)
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return res.returncode == 0

def merge_photo_with_audio(photo_path, audio_path, out_path, max_duration=30.0):
    """Gabungkan satu foto dengan audio menjadi video MP4."""
    dur = 15.0
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)
        ], capture_output=True, text=True, check=True)
        dur = float(probe.stdout.strip())
        dur = min(max(dur, 5.0), max_duration)
    except Exception:
        dur = 15.0

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "1", "-t", str(dur), "-i", str(photo_path),
        "-t", str(dur), "-i", str(audio_path),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p",
        "-profile:v", "main", "-level", "4.0",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart", "-shortest",
        str(out_path)
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    return out_path

def merge_carousel_with_audio(image_paths, audio_path, out_path, max_duration=60.0):
    """Gabungkan slide carousel (banyak foto) dengan audio menjadi video slideshow MP4."""
    if not image_paths:
        return None
    if len(image_paths) == 1:
        return merge_photo_with_audio(image_paths[0], audio_path, out_path, max_duration)

    dur = 30.0
    try:
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)
        ], capture_output=True, text=True, check=True)
        dur = float(probe.stdout.strip())
        dur = min(max(dur, 5.0), max_duration)
    except Exception:
        dur = 30.0

    n = len(image_paths)
    slide_dur = round(max(2.5, dur / n), 2)

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as tf:
        for img in image_paths:
            tf.write(f"file '{os.path.abspath(img)}'\n")
            tf.write(f"duration {slide_dur}\n")
        tf.write(f"file '{os.path.abspath(image_paths[-1])}'\n")
        concat_file = tf.name

    try:
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", concat_file,
            "-i", str(audio_path),
            "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "main", "-level", "4.0", "-r", "25",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
            "-movflags", "+faststart", "-shortest",
            str(out_path)
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return out_path
    finally:
        if os.path.exists(concat_file):
            try:
                os.remove(concat_file)
            except Exception:
                pass

def try_ytdlp(url, shortcode):
    """Coba unduh via yt-dlp jika itu adalah Reel / Video murni."""
    target_mp4 = os.path.join(DEFAULT_OUT, f"ig_{shortcode}.mp4")
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--force-overwrites",
        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "-o", target_mp4,
    ]
    if os.path.exists(COOKIE_FILE):
        cmd.extend(["--cookies", COOKIE_FILE])
    warp_proxy = get_warp_proxy()
    if warp_proxy:
        cmd.extend(["--proxy", warp_proxy])
    cmd.append(url)

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0 and os.path.exists(target_mp4) and os.path.getsize(target_mp4) > 10240:
        opt_path = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_opt.mp4")
        if optimize_video(target_mp4, opt_path):
            final = publish_file(opt_path, f"ig_{shortcode}.mp4")
        else:
            final = publish_file(target_mp4, f"ig_{shortcode}.mp4")
        return {
            "ok": True,
            "type": "video",
            "path": final,
            "paths": [final],
            "shortcode": shortcode,
            "has_audio": True,
            "size": os.path.getsize(final)
        }
    return None

def extract_audio_info_from_item(item):
    """Ekstrak URL audio mentah (.m4a) dari dictionary item Instagram."""
    if not item or not isinstance(item, dict):
        return None, None

    title = None
    music_url = None

    # 1. clips_metadata -> music_info
    clips_meta = item.get("clips_metadata") or {}
    music_info = clips_meta.get("music_info") or item.get("music_info") or {}
    if music_info and isinstance(music_info, dict):
        masset = music_info.get("music_asset_info") or {}
        title = masset.get("title") or masset.get("song_name")
        music_url = masset.get("progressive_download_url") or masset.get("fast_start_progressive_download_url")

    # 2. music_metadata -> music_info
    if not music_url:
        mmeta = item.get("music_metadata") or {}
        minfo = mmeta.get("music_info") or {}
        if minfo and isinstance(minfo, dict):
            masset = minfo.get("music_asset_info") or {}
            title = title or masset.get("title") or masset.get("song_name")
            music_url = masset.get("progressive_download_url") or masset.get("fast_start_progressive_download_url")

    # 3. clips_music_attribution_info
    if not music_url:
        attr = item.get("clips_music_attribution_info") or clips_meta.get("clips_music_attribution_info") or {}
        if attr and isinstance(attr, dict):
            title = title or attr.get("song_name") or attr.get("audio_asset_id")
            music_url = attr.get("progressive_download_url") or attr.get("fast_start_progressive_download_url")

    # 4. story_music_stickers
    if not music_url:
        stickers = item.get("story_music_stickers") or []
        if stickers and isinstance(stickers, list):
            s = stickers[0].get("music_asset_info") or {}
            title = title or s.get("title")
            music_url = s.get("progressive_download_url") or s.get("fast_start_progressive_download_url")

    return music_url, title

def get_warp_proxy():
    """Cek apakah Cloudflare WARP SOCKS5 proxy aktif di port 40000."""
    import socket
    try:
        with socket.create_connection(("127.0.0.1", 40000), timeout=0.5):
            return "socks5://127.0.0.1:40000"
    except Exception:
        return None

def try_instagrapi(url, shortcode, merge_audio=True, audio_only=False):
    """Jalur privat instagrapi jika cookie sessionid tersedia."""
    session_id = os.environ.get("INSTAGRAM_SESSION_ID")
    if not session_id and os.path.exists(COOKIE_FILE):
        try:
            with open(COOKIE_FILE, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if "\tsessionid\t" in line:
                        parts = line.strip().split("\t")
                        if len(parts) >= 7:
                            session_id = parts[6]
                            break
        except Exception:
            pass

    if not session_id:
        return None

    try:
        from instagrapi import Client
        cl = Client()
        warp_proxy = get_warp_proxy()
        if warp_proxy:
            cl.set_proxy(warp_proxy)
        cl.login_by_sessionid(session_id)
        pk = cl.media_pk_from_url(url)
        raw_info = cl.private_request(f"media/{pk}/info/")
        items = raw_info.get("items", [])
        if not items:
            return None
        item = items[0]

        # 1. Video / Reels
        if item.get("media_type") == 2 or item.get("video_versions"):
            fn = cl.video_download(pk, folder=DEFAULT_OUT)
            opt = os.path.join(DEFAULT_OUT, f"opt_{shortcode}.mp4")
            if optimize_video(fn, opt):
                final = publish_file(opt, f"ig_{shortcode}.mp4")
            else:
                final = publish_file(fn, f"ig_{shortcode}.mp4")
            return {
                "ok": True,
                "type": "video",
                "path": final,
                "paths": [final],
                "shortcode": shortcode,
                "has_audio": True,
                "size": os.path.getsize(final)
            }

        # 2. Carousel
        resources = item.get("carousel_media")
        if resources:
            downloaded = []
            for idx, r in enumerate(resources, 1):
                if r.get("video_versions"):
                    u = r["video_versions"][0]["url"]
                    fn = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_{idx}.mp4")
                    urllib.request.urlretrieve(u, fn)
                    opt = os.path.join(DEFAULT_OUT, f"opt_{shortcode}_{idx}.mp4")
                    if optimize_video(fn, opt):
                        pub = publish_file(opt, f"ig_{shortcode}_{idx}.mp4")
                    else:
                        pub = publish_file(fn, f"ig_{shortcode}_{idx}.mp4")
                    downloaded.append(pub)
                else:
                    u = r["image_versions2"]["candidates"][0]["url"]
                    fn = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_{idx}.jpg")
                    urllib.request.urlretrieve(u, fn)
                    pub = publish_file(fn, f"ig_{shortcode}_{idx}.jpg")
                    downloaded.append(pub)

            music_url, song_title = extract_audio_info_from_item(item)
            if not music_url:
                for r in resources:
                    m_u, s_t = extract_audio_info_from_item(r)
                    if m_u:
                        music_url = m_u
                        song_title = s_t
                        break

            if audio_only and music_url:
                aud_file = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
                urllib.request.urlretrieve(music_url, aud_file)
                if check_audio_volume(aud_file):
                    pub_aud = publish_file(aud_file, f"ig_{shortcode}_audio.m4a")
                    return {
                        "ok": True,
                        "type": "audio",
                        "path": pub_aud,
                        "paths": [pub_aud],
                        "shortcode": shortcode,
                        "title": song_title,
                        "has_audio": True,
                        "size": os.path.getsize(pub_aud)
                    }

            if music_url and merge_audio and downloaded:
                img_slides = [p for p in downloaded if p.endswith(".jpg")]
                if img_slides:
                    aud_file = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
                    urllib.request.urlretrieve(music_url, aud_file)
                    if check_audio_volume(aud_file):
                        merged = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_slide.mp4")
                        try:
                            merge_carousel_with_audio(img_slides, aud_file, merged)
                            pub_m = publish_file(merged, f"ig_{shortcode}_slide.mp4")
                            return {
                                "ok": True,
                                "type": "video",
                                "sub_type": "slideshow",
                                "path": pub_m,
                                "paths": [pub_m] + downloaded,
                                "shortcode": shortcode,
                                "title": song_title,
                                "has_audio": True,
                                "size": os.path.getsize(pub_m)
                            }
                        except Exception:
                            pass

            return {
                "ok": True,
                "type": "carousel",
                "path": downloaded[0],
                "paths": downloaded,
                "shortcode": shortcode,
                "has_audio": bool(music_url),
                "size": sum(os.path.getsize(p) for p in downloaded if os.path.exists(p))
            }

        # 3. Foto Tunggal
        photo_fn = cl.photo_download(pk, folder=DEFAULT_OUT)
        pub_photo = publish_file(photo_fn, f"ig_{shortcode}.jpg")

        music_url, song_title = extract_audio_info_from_item(item)

        if audio_only and music_url:
            aud_file = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
            urllib.request.urlretrieve(music_url, aud_file)
            if check_audio_volume(aud_file):
                pub_aud = publish_file(aud_file, f"ig_{shortcode}_audio.m4a")
                return {
                    "ok": True,
                    "type": "audio",
                    "path": pub_aud,
                    "paths": [pub_aud],
                    "shortcode": shortcode,
                    "title": song_title,
                    "has_audio": True,
                    "size": os.path.getsize(pub_aud)
                }

        if music_url and merge_audio:
            aud_file = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
            urllib.request.urlretrieve(music_url, aud_file)
            if check_audio_volume(aud_file):
                merged = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_slide.mp4")
                try:
                    merge_photo_with_audio(pub_photo, aud_file, merged)
                    pub_m = publish_file(merged, f"ig_{shortcode}_slide.mp4")
                    return {
                        "ok": True,
                        "type": "video",
                        "sub_type": "slideshow",
                        "path": pub_m,
                        "paths": [pub_m, pub_photo],
                        "shortcode": shortcode,
                        "title": song_title,
                        "has_audio": True,
                        "size": os.path.getsize(pub_m)
                    }
                except Exception:
                    pass

        return {
            "ok": True,
            "type": "image",
            "path": pub_photo,
            "paths": [pub_photo],
            "shortcode": shortcode,
            "has_audio": bool(music_url),
            "size": os.path.getsize(pub_photo)
        }
    except Exception as e:
        sys.stderr.write(f"[*] instagrapi private request error: {e}\n")
        return None

def get_decodo_key():
    """Ambil API key Decodo aktif dari .env.local atau environment."""
    env_local = "/root/ai-chat/.env.local"
    if os.path.exists(env_local):
        try:
            with open(env_local, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("DECODO_API_KEY="):
                        val = line.strip().split("=", 1)[1].strip('"\'')
                        if val:
                            return val
        except Exception:
            pass
    return os.environ.get("DECODO_API_KEY", "ef4e72d0a2e22c08f839945b13f91553bd8307f3a2aaac26f567660944f36c61")

def parse_instagram_html(html, shortcode, merge_audio=True, audio_only=False, audio_query=None):
    """Parse media links dan audio dari HTML dump Instagram."""
    if not html or len(html) < 500:
        return None
    if "monthly api calls limit reached" in html.lower() or "limit reached" in html.lower():
        return None

    # Cari kandidat URL audio
    audio_urls_found = []
    for m in re.finditer(r'"(?:progressive_download_url|fast_start_progressive_download_url|audio_src)":\s*"([^"]+)"', html):
        u = m.group(1).replace(r"\/", "/").encode().decode("unicode_escape")
        if u not in audio_urls_found:
            audio_urls_found.append(u)

    for m in re.finditer(r'https?:\\/\\/[^\s"\'<>]+\.(?:m4a|mp3)[^\s"\'<>]*', html):
        u = m.group(0).replace(r"\/", "/").encode().decode("unicode_escape")
        if u not in audio_urls_found:
            audio_urls_found.append(u)

    song_title = None
    m_title = re.search(r'"(?:audio_product_name|song_name)":\s*"([^"]+)"', html)
    if not m_title:
        m_title = re.search(r'"clips_music_attribution_info":\s*\{[^}]*"title":\s*"([^"]+)"', html, re.S)
    if not m_title:
        m_title = re.search(r'"music_info":\s*\{[^}]*"title":\s*"([^"]+)"', html, re.S)
    if m_title:
        song_title = m_title.group(1).encode().decode("unicode_escape")

    # Cari kandidat video
    video_urls_found = []
    for m in re.finditer(r'"video_versions":\s*\[(.*?)\]', html, re.S):
        for u in re.findall(r'"url":\s*"(https:[^"]+?)"', m.group(1)):
            clean_u = u.replace(r"\/", "/").replace(r"\u0026", "&")
            if clean_u not in video_urls_found:
                video_urls_found.append(clean_u)

    # Cari kandidat gambar
    image_urls_found = []
    for m in re.finditer(r'"image_versions2":\s*\{\s*"candidates":\s*\[(.*?)\]', html, re.S):
        for u in re.findall(r'"url":\s*"(https:[^"]+?)"', m.group(1)):
            clean_u = u.replace(r"\/", "/").replace(r"\u0026", "&")
            if clean_u not in image_urls_found:
                image_urls_found.append(clean_u)

    for m in re.finditer(r'"display_uri":\s*"(https:[^"]+?)"', html):
        clean_u = m.group(1).replace(r"\/", "/").replace(r"\u0026", "&")
        if clean_u not in image_urls_found:
            image_urls_found.append(clean_u)

    headers = {"User-Agent": UA, "Referer": "https://www.instagram.com/"}

    # Audio-only handling
    if audio_only:
        for a_url in audio_urls_found:
            aud_target = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
            try:
                req = urllib.request.Request(a_url, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as r, open(aud_target, "wb") as f:
                    f.write(r.read())
                if check_audio_volume(aud_target):
                    pub = publish_file(aud_target, f"ig_{shortcode}_audio.m4a")
                    return {
                        "ok": True,
                        "type": "audio",
                        "path": pub,
                        "paths": [pub],
                        "shortcode": shortcode,
                        "title": song_title,
                        "has_audio": True,
                        "size": os.path.getsize(pub)
                    }
            except Exception:
                pass
        return None

    # Video / Reels handling
    if video_urls_found:
        vid_target = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_raw.mp4")
        try:
            req = urllib.request.Request(video_urls_found[0], headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r, open(vid_target, "wb") as f:
                f.write(r.read())
            opt_path = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_opt.mp4")
            if optimize_video(vid_target, opt_path):
                final = publish_file(opt_path, f"ig_{shortcode}.mp4")
            else:
                final = publish_file(vid_target, f"ig_{shortcode}.mp4")
            return {
                "ok": True,
                "type": "video",
                "path": final,
                "paths": [final],
                "shortcode": shortcode,
                "has_audio": True,
                "size": os.path.getsize(final)
            }
        except Exception:
            pass

    # Gambar / Carousel handling
    if not image_urls_found:
        return None

    downloaded_images = []
    unique_imgs = []
    for u in image_urls_found:
        base_id = u.split("?")[0].split("/")[-1]
        if not any(base_id in x for x in unique_imgs):
            unique_imgs.append(u)

    for idx, img_url in enumerate(unique_imgs[:10], 1):
        suffix = f"_{idx}" if len(unique_imgs) > 1 else ""
        img_fn = os.path.join(DEFAULT_OUT, f"ig_{shortcode}{suffix}.jpg")
        try:
            req = urllib.request.Request(img_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r, open(img_fn, "wb") as f:
                f.write(r.read())
            if os.path.getsize(img_fn) > 3000:
                pub = publish_file(img_fn, f"ig_{shortcode}{suffix}.jpg")
                downloaded_images.append(pub)
        except Exception:
            pass

    if not downloaded_images:
        return None

    # Unduh audio dari CDN jika ada dan validasi
    validated_audio = None
    for a_url in audio_urls_found:
        aud_target = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
        try:
            req = urllib.request.Request(a_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r, open(aud_target, "wb") as f:
                f.write(r.read())
            if check_audio_volume(aud_target):
                validated_audio = aud_target
                break
        except Exception:
            pass

    # Fallback audio query jika diminta secara eksplisit
    if not validated_audio and audio_query:
        validated_audio = download_audio_by_query(audio_query, shortcode)

    # Auto-fallback: stream audio tidak ada di payload (umum untuk carousel
    # berlagu) tapi judul trek diketahui — cari via YouTube lalu merge.
    if not validated_audio and not audio_query and merge_audio and song_title:
        if "original audio" not in song_title.lower():
            validated_audio = download_audio_by_query(song_title, shortcode)

    # Jika merge_audio aktif dan audio tervalidasi bersuara
    if merge_audio and validated_audio:
        merged_video = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_merged.mp4")
        try:
            if len(downloaded_images) > 1:
                merge_carousel_with_audio(downloaded_images, validated_audio, merged_video)
            else:
                merge_photo_with_audio(downloaded_images[0], validated_audio, merged_video)

            pub_vid = publish_file(merged_video, f"ig_{shortcode}_merged.mp4")
            return {
                "ok": True,
                "type": "video",
                "sub_type": "slideshow",
                "path": pub_vid,
                "paths": [pub_vid] + downloaded_images,
                "shortcode": shortcode,
                "title": song_title or audio_query,
                "has_audio": True,
                "size": os.path.getsize(pub_vid)
            }
        except Exception as e:
            sys.stderr.write(f"[*] Gagal merge audio ({e})\n")

    return {
        "ok": True,
        "type": "image" if len(downloaded_images) == 1 else "carousel",
        "path": downloaded_images[0],
        "paths": downloaded_images,
        "shortcode": shortcode,
        "has_audio": bool(validated_audio),
        "size": sum(os.path.getsize(p) for p in downloaded_images if os.path.exists(p))
    }

def extract_via_decodo(url, shortcode, merge_audio=True, audio_only=False, audio_query=None):
    """Jalur Decodo API (Residential Rotating Proxies) untuk payload Instagram publik."""
    key = get_decodo_key()
    if not key:
        return None
    try:
        req = urllib.request.Request(
            "https://data.decodo.com/v1/scrape",
            data=json.dumps({"url": url, "target": "universal"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
        )
        with urllib.request.urlopen(req, timeout=35) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            raw = data.get("results", [{}])[0].get("content", "")
            if raw and len(raw) > 500:
                res = parse_instagram_html(raw, shortcode, merge_audio=merge_audio, audio_only=audio_only, audio_query=audio_query)
                if res and res.get("ok"):
                    return res
    except Exception as e:
        sys.stderr.write(f"[*] Decodo scrape error: {e}\n")
    return None

def extract_via_scrapingbee(url, shortcode, merge_audio=True, audio_only=False, audio_query=None):
    """Jalur utama ScrapingBee untuk payload Instagram publik tanpa login."""
    key = get_scrapingbee_key()
    if not key:
        return None

    html = ""
    sb_url = f"https://app.scrapingbee.com/api/v1/?api_key={key}&url={urllib.parse.quote(url)}&render_js=false"
    try:
        req = urllib.request.Request(sb_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=35) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        sys.stderr.write(f"[*] ScrapingBee render_js=false error ({e}), mencoba render_js=true...\n")
        try:
            sb_url = f"https://app.scrapingbee.com/api/v1/?api_key={key}&url={urllib.parse.quote(url)}&render_js=true&wait=4000"
            req = urllib.request.Request(sb_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
        except Exception as e2:
            sys.stderr.write(f"[*] ScrapingBee render_js=true error: {e2}\n")
            return None

    if not html or len(html) < 500 or "monthly api calls limit reached" in html.lower():
        return None

    return parse_instagram_html(html, shortcode, merge_audio=merge_audio, audio_only=audio_only, audio_query=audio_query)

async def extract_via_playwright(url, shortcode, merge_audio=True, custom_audio=None, audio_only=False, audio_query=None):
    """Fallback via Playwright / Patchright Headless Chromium."""
    from patchright.async_api import async_playwright

    captured_audio_urls = []
    captured_video_urls = []
    captured_image_urls = []
    captured_music_titles = []
    response_texts = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        warp_proxy = get_warp_proxy()
        ctx_args = {
            "viewport": {"width": 1280, "height": 900},
            "user_agent": UA
        }
        if warp_proxy:
            ctx_args["proxy"] = {"server": warp_proxy}

        ctx = await browser.new_context(**ctx_args)

        session_id = os.environ.get("INSTAGRAM_SESSION_ID")
        if session_id:
            try:
                await ctx.add_cookies([
                    {"name": "sessionid", "value": session_id, "domain": ".instagram.com", "path": "/"}
                ])
            except Exception:
                pass

        page = await ctx.new_page()

        async def handle_response(res):
            try:
                u = res.url
                ct = (res.headers.get("content-type") or "").lower()
                if "audio" in ct or ".m4a" in u or ".mp3" in u:
                    captured_audio_urls.append(u)
                elif "video" in ct or ".mp4" in u:
                    if "cdninstagram.com" in u or "fbcdn.net" in u:
                        captured_video_urls.append(u)
                elif ("json" in ct or "javascript" in ct) and ("graphql" in u or "/api/v1/" in u or "embed" in u):
                    text = await res.text()
                    response_texts.append(text)
            except Exception:
                pass

        page.on("response", handle_response)

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=40000)
            await page.wait_for_timeout(4000)
        except Exception:
            pass

        scripts_content = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('script')).map(s => s.textContent || '');
        }""")
        response_texts.extend(scripts_content)

        dom_images = await page.evaluate("""() => {
            const imgs = Array.from(document.querySelectorAll('article img, main img, div[role="dialog"] img'));
            return imgs.map(i => ({ src: i.src, w: i.naturalWidth || 0, h: i.naturalHeight || 0 }))
                       .filter(i => i.src && (i.src.includes('cdninstagram.com') || i.src.includes('fbcdn.net')));
        }""")
        for item in dom_images:
            if item["src"] not in captured_image_urls:
                captured_image_urls.append(item["src"])

        dom_music = await page.evaluate("""() => {
            const els = document.querySelectorAll('a[href*="/reels/audio/"], a[href*="/explore/music/"], [aria-label*="udio"]');
            return Array.from(els).map(e => ((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '')).trim()).filter(t => t.length > 2 && t.length < 90);
        }""")
        captured_music_titles.extend(dict.fromkeys(dom_music))

        await browser.close()

    audio_urls_found = list(captured_audio_urls)
    image_urls_found = list(captured_image_urls)
    video_urls_found = list(captured_video_urls)

    for text in response_texts:
        if not text or len(text) < 20:
            continue
        for m in re.finditer(r'"(?:progressive_download_url|fast_start_progressive_download_url|audio_src|playback_url)":\s*"([^"]+)"', text):
            clean_u = m.group(1).replace(r"\/", "/").encode().decode("unicode_escape")
            if clean_u not in audio_urls_found:
                audio_urls_found.append(clean_u)
        for m in re.finditer(r'https?:\\/\\/[^\s"\'<>]+\.(?:m4a|mp3)[^\s"\'<>]*', text):
            clean_u = m.group(0).replace(r"\/", "/").encode().decode("unicode_escape")
            if clean_u not in audio_urls_found:
                audio_urls_found.append(clean_u)
        for m in re.finditer(r'"image_versions2":\s*\{\s*"candidates":\s*\[(.*?)\]', text, re.S):
            for u in re.findall(r'"url":\s*"(https:[^"]+?)"', m.group(1)):
                clean_u = u.replace(r"\/", "/").replace(r"\u0026", "&")
                if clean_u not in image_urls_found:
                    image_urls_found.append(clean_u)
        for m in re.finditer(r'"video_versions":\s*\[(.*?)\]', text, re.S):
            for u in re.findall(r'"url":\s*"(https:[^"]+?)"', m.group(1)):
                clean_u = u.replace(r"\/", "/").replace(r"\u0026", "&")
                if clean_u not in video_urls_found:
                    video_urls_found.append(clean_u)
        for m in re.finditer(r'"(?:audio_product_name|song_name)":\s*"([^"]+)"', text):
            t = m.group(1).replace(r"\/", "/").encode().decode("unicode_escape").strip()
            if t and t not in captured_music_titles:
                captured_music_titles.append(t)

    headers = {"User-Agent": UA, "Referer": "https://www.instagram.com/"}

    if audio_only:
        for a_url in audio_urls_found:
            audio_file = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_audio.m4a")
            try:
                req = urllib.request.Request(a_url, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as r, open(audio_file, "wb") as f:
                    f.write(r.read())
                if check_audio_volume(audio_file):
                    pub = publish_file(audio_file, f"ig_{shortcode}_audio.m4a")
                    return {"ok": True, "type": "audio", "path": pub, "paths": [pub], "shortcode": shortcode, "size": os.path.getsize(pub)}
            except Exception:
                pass
        return {"ok": False, "error": "Postingan ini tidak memiliki trek musik bawaan yang valid.", "shortcode": shortcode}

    if video_urls_found:
        vid_target = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_raw.mp4")
        try:
            req = urllib.request.Request(video_urls_found[0], headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r, open(vid_target, "wb") as f:
                f.write(r.read())
            opt_path = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_opt.mp4")
            if optimize_video(vid_target, opt_path):
                final = publish_file(opt_path, f"ig_{shortcode}.mp4")
            else:
                final = publish_file(vid_target, f"ig_{shortcode}.mp4")
            return {
                "ok": True,
                "type": "video",
                "path": final,
                "paths": [final],
                "shortcode": shortcode,
                "has_audio": True,
                "size": os.path.getsize(final)
            }
        except Exception:
            pass

    if not image_urls_found:
        return {"ok": False, "error": "Tidak dapat mengekstrak media dari URL Instagram ini.", "shortcode": shortcode}

    downloaded_images = []
    unique_imgs = []
    for u in image_urls_found:
        base_id = u.split("?")[0].split("/")[-1]
        if not any(base_id in x for x in unique_imgs):
            unique_imgs.append(u)

    for idx, img_url in enumerate(unique_imgs[:10], 1):
        suffix = f"_{idx}" if len(unique_imgs) > 1 else ""
        img_fn = os.path.join(DEFAULT_OUT, f"ig_{shortcode}{suffix}.jpg")
        try:
            req = urllib.request.Request(img_url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r, open(img_fn, "wb") as f:
                f.write(r.read())
            if os.path.getsize(img_fn) > 3000:
                pub = publish_file(img_fn, f"ig_{shortcode}{suffix}.jpg")
                downloaded_images.append(pub)
        except Exception:
            pass

    if not downloaded_images:
        return {"ok": False, "error": "Gagal mengunduh berkas gambar Instagram.", "shortcode": shortcode}

    target_audio_file = None
    if custom_audio and os.path.exists(custom_audio):
        if check_audio_volume(custom_audio):
            target_audio_file = custom_audio
    elif audio_urls_found:
        for a_url in audio_urls_found:
            aud_target = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_temp_audio.m4a")
            try:
                req = urllib.request.Request(a_url, headers=headers)
                with urllib.request.urlopen(req, timeout=30) as r, open(aud_target, "wb") as f:
                    f.write(r.read())
                if check_audio_volume(aud_target):
                    target_audio_file = aud_target
                    break
            except Exception:
                pass

    if not target_audio_file and audio_query:
        target_audio_file = download_audio_by_query(audio_query, shortcode)

    # Auto-fallback: tanpa stream audio tapi judul trek terbaca dari payload/DOM
    # → cari lagu via YouTube lalu merge (carousel berlagu wajib keluar MP4).
    if not target_audio_file and not audio_query and merge_audio and captured_music_titles:
        auto_title = next((t for t in captured_music_titles if "original audio" not in t.lower()), None)
        if auto_title:
            sys.stderr.write(f"[*] Audio stream tidak ada; coba lagu '{auto_title}' via pencarian YouTube...\n")
            target_audio_file = download_audio_by_query(auto_title, shortcode)

    if merge_audio and target_audio_file:
        merged_video = os.path.join(DEFAULT_OUT, f"ig_{shortcode}_merged.mp4")
        try:
            if len(downloaded_images) > 1:
                merge_carousel_with_audio(downloaded_images, target_audio_file, merged_video)
            else:
                merge_photo_with_audio(downloaded_images[0], target_audio_file, merged_video)
            pub = publish_file(merged_video, f"ig_{shortcode}_merged.mp4")
            return {
                "ok": True,
                "type": "video",
                "sub_type": "slideshow",
                "path": pub,
                "paths": [pub] + downloaded_images,
                "shortcode": shortcode,
                "has_audio": True,
                "size": os.path.getsize(pub)
            }
        except Exception as e:
            sys.stderr.write(f"[*] Playwright merge error: {e}\n")

    return {
        "ok": True,
        "type": "image" if len(downloaded_images) == 1 else "carousel",
        "path": downloaded_images[0],
        "paths": downloaded_images,
        "shortcode": shortcode,
        "has_audio": bool(target_audio_file),
        "size": sum(os.path.getsize(p) for p in downloaded_images if os.path.exists(p))
    }

def main():
    parser = argparse.ArgumentParser(description="Downloader Instagram Terpadu V3")
    parser.add_argument("url", help="URL atau shortcode Instagram")
    parser.add_argument("--merge-audio", action="store_true", default=True, help="Otomatis gabungkan foto/carousel dengan audio jadi MP4 (default: True)")
    parser.add_argument("--no-merge-audio", dest="merge_audio", action="store_false", help="Nonaktifkan penggabungan audio")
    parser.add_argument("--audio-only", action="store_true", help="Hanya unduh berkas musik/audio latar (.m4a)")
    parser.add_argument("--audio-source", help="Berkas audio lokal atau URL audio alternatif untuk dimerger")
    parser.add_argument("--audio-query", "--song", dest="audio_query", help="Judul lagu untuk diunduh via pencarian YouTube dan digabungkan")
    args = parser.parse_args()

    shortcode = extract_shortcode(args.url)
    if not shortcode:
        emit({"ok": False, "error": "URL atau shortcode Instagram tidak valid.", "shortcode": None}, 2)

    # 1. Cek apakah video hasil merger bersuara sudah pernah dibuat sebelumnya (Cache Reuse)
    if args.merge_audio and not args.audio_only and not args.audio_source and not args.audio_query:
        cached = check_existing_merged(shortcode)
        if cached:
            emit(cached)

    clean_url = f"https://www.instagram.com/p/{shortcode}/" if not args.url.startswith("http") else args.url

    # Carousel tanpa audio TIDAK langsung diterima: payload publik sering tidak
    # memuat stream/title musik, sedangkan jalur Playwright bisa membacanya dari
    # DOM/XHR. Hasil tanpa audio disimpan sebagai fallback terakhir (deferred).
    deferred = None
    def accept(res):
        nonlocal deferred
        if not res or not res.get("ok"):
            return False
        if (args.merge_audio and not args.audio_only
                and res.get("type") in ("image", "carousel")
                and not res.get("has_audio")):
            if deferred is None:
                deferred = res
            return False
        emit(res)
        return True

    # 2. Coba jalur privat instagrapi (jika sessionid tersedia)
    res_insta = try_instagrapi(clean_url, shortcode, merge_audio=args.merge_audio, audio_only=args.audio_only)
    accept(res_insta)

    # 3. Coba via yt-dlp jika reel/video dan bukan request custom merge/audio-only
    if not args.audio_only and not args.audio_source and not args.audio_query:
        res_yt = try_ytdlp(clean_url, shortcode)
        accept(res_yt)

    # 4. Jalur Decodo API (Residential Rotating Proxies)
    res_decodo = extract_via_decodo(
        clean_url,
        shortcode,
        merge_audio=args.merge_audio,
        audio_only=args.audio_only,
        audio_query=args.audio_query
    )
    accept(res_decodo)

    # 4b. Jalur publik: ScrapingBee API (jika memiliki kuota aktif)
    res_sb = extract_via_scrapingbee(
        clean_url,
        shortcode,
        merge_audio=args.merge_audio,
        audio_only=args.audio_only,
        audio_query=args.audio_query
    )
    accept(res_sb)

    # 5. Jalur fallback Playwright / Patchright
    result = asyncio.run(extract_via_playwright(
        clean_url,
        shortcode,
        merge_audio=args.merge_audio,
        custom_audio=args.audio_source,
        audio_only=args.audio_only,
        audio_query=args.audio_query
    ))
    if result and result.get("ok"):
        emit(result, 0)
    if deferred:
        emit(deferred, 0)
    emit(result or {"ok": False, "error": "Semua jalur gagal.", "shortcode": shortcode}, 1)

if __name__ == "__main__":
    main()
