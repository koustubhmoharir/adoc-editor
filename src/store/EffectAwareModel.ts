import { action, observable } from "mobx";

export class EffectAwareModel {
    // Queue of callbacks (non-observable as per pattern)
    private effectCallbacks: (() => void)[] = [];
    @observable.ref private accessor trigger: object | null = null;

    @action
    scheduleEffect(callback: () => void) {
        this.trigger = {};
        this.effectCallbacks.push(callback);
    }

    get effects() {
        this.trigger; // Ensure that this is accessed to force a rerender when scheduleEffect is called
        return this.consumeEffects;
    }

    @action.bound
    private consumeEffects() {
        const callbacks = this.effectCallbacks;
        this.effectCallbacks = [];
        callbacks.forEach(cb => cb());
    }
}
