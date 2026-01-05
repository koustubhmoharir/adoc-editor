import React from 'react';
import { observer } from 'mobx-react-lite';
import * as styles from './Dialog.css';
import { observable, action } from "mobx";
import { appName } from "../store/ThemeStore";

type DialogType = 'alert' | 'confirm';

interface Dialog {
    alert(message: string, title?: string): Promise<void>;
    confirm(message: string, title?: string): Promise<boolean>;
}

class DialogStore implements Dialog {
    @observable accessor type: DialogType = 'alert';
    @observable accessor message: string = '';
    @observable accessor title: string = '';

    dialogRef: React.RefObject<HTMLDialogElement> = React.createRef();
    confirmButtonRef: React.RefObject<HTMLButtonElement> = React.createRef();
    private resolvePromise: ((value: any) => void) | null = null;
    private pendingResult: any = undefined;

    @action
    private show(type: DialogType, message: string, title?: string): Promise<any> {
        this.type = type;
        this.message = message;
        this.title = title || appName;
        this.pendingResult = undefined;

        if (this.dialogRef.current) {
            this.dialogRef.current.showModal();
        }
        // Schedule showModal and focus
        //this.scheduleEffect(() => {
        if (this.confirmButtonRef.current) {
            this.confirmButtonRef.current.focus();
        }
        //});

        return new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
    }

    @action
    private close() {
        if (this.dialogRef.current && this.dialogRef.current.open) {
            this.dialogRef.current.close();
        }
    }

    @action
    alert(message: string, title?: string): Promise<void> {
        return this.show('alert', message, title);
    }

    @action
    confirm(message: string, title?: string): Promise<boolean> {
        return this.show('confirm', message, title);
    }

    @action
    handleConfirm = () => {
        this.pendingResult = true;
        this.close();
    }

    @action
    handleCancel = () => {
        if (this.type === 'confirm') {
            this.pendingResult = false;
        } else {
            this.pendingResult = undefined;
        }
        this.close();
    }

    @action
    onCancelled = (e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
        // The 'cancel' event is fired when the user presses Esc.
        // We set the pending result, but do NOT need to call close() manually
        // because the browser will close the dialog after this event (unless prevented).
        if (this.type === 'confirm') {
            this.pendingResult = false;
        } else {
            this.pendingResult = undefined;
        }
    }

    @action
    onClosed = () => {
        // Resolve the promise with the pending result (key fix: only resolve now)
        if (this.resolvePromise) {
            this.resolvePromise(this.pendingResult);
            this.resolvePromise = null;
        }
        this.pendingResult = undefined;
    }
}

const dialogStore = new DialogStore();


export const NativeDialog: React.FC = observer(() => {
    const { type, message, title } = dialogStore;

    const defaultTitle = type === 'alert' ? 'Notification' : 'Confirm';
    const displayTitle = title || defaultTitle;

    return (
        <dialog
            ref={dialogStore.dialogRef}
            className={styles.dialog}
            onCancel={dialogStore.onCancelled}
            onClose={dialogStore.onClosed}
            data-testid="dialog-overlay"
        >
            <div className={styles.dialogContent}>
                <div className={styles.header} id="dialog-title">{displayTitle}</div>
                <div className={styles.body}>{message}</div>
                <div className={styles.footer}>
                    {type === 'confirm' && (
                        <button
                            className={styles.button}
                            onClick={dialogStore.handleCancel}
                            data-testid="dialog-cancel-button"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        className={styles.primaryButton}
                        onClick={dialogStore.handleConfirm}
                        ref={dialogStore.confirmButtonRef}
                        data-testid="dialog-confirm-button"
                    >
                        OK
                    </button>
                </div>
            </div>
        </dialog>
    );
});

export const dialog: Dialog = dialogStore;

// Expose for testing/debugging
if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
    (window as any).__TEST_dialog = dialog;
}