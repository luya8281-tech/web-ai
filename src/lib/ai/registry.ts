import { ProviderRepository } from '../db/repositories/provider-repo';
import { Model } from '@/types/chat';
import { AIRouter } from './router';

export class ModelRegistry {
  static getModels(providerId?: string): Model[] {
    return ProviderRepository.listModels(providerId);
  }

  static getModel(id: string): Model | null {
    return ProviderRepository.getModel(id);
  }

  static async discoverAndSync(providerId: string): Promise<Model[]> {
    const provider = AIRouter.getProviderInstance(providerId);
    const discovered = await provider.listModels();

    if (discovered.length > 0) {
      ProviderRepository.upsertModels(providerId, discovered);
    }

    return ProviderRepository.listModels(providerId);
  }
}
