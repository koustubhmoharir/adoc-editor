import { useEffect } from 'react';
import { EffectAwareModel } from '../store/EffectAwareModel';

export const useScheduledEffects = (model: EffectAwareModel) => {
    useEffect(model.effects);
};
