/**
 * Cloudflare Turnstile Server Verification Helper
 */

export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null
): Promise<{ success: boolean; error?: string }> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();

  // If Turnstile is not configured, bypass verification
  if (!secretKey) {
    return { success: true };
  }

  if (!token || !token.trim()) {
    return { success: false, error: 'Silakan selesaikan verifikasi "Saya bukan robot" terlebih dahulu.' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token.trim());
    if (remoteIp) {
      formData.append('remoteip', remoteIp);
    }

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await res.json();

    if (data.success) {
      return { success: true };
    }

    const errorCodes = (data['error-codes'] || []).join(', ');
    return {
      success: false,
      error: errorCodes ? `Verifikasi Cloudflare gagal (${errorCodes})` : 'Verifikasi Cloudflare tidak valid.',
    };
  } catch (err: any) {
    console.error('[Turnstile Verification Error]', err);
    return { success: false, error: 'Gagal menghubungi server verifikasi Cloudflare.' };
  }
}
