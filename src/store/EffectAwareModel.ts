import { action } from "mobx";

export class EffectAwareModel {
    // Queue of callbacks (non-observable as per pattern)
    effectCallbacks: (() => void)[] = [];

    scheduleEffect(callback: () => void) {
        this.effectCallbacks.push(callback);
    }

    @action
    consumeEffects() {
        const callbacks = this.effectCallbacks;
        this.effectCallbacks = [];
        callbacks.forEach(cb => cb());
    }
}
