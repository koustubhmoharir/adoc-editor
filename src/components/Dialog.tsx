import React from 'react';
import { observer } from 'mobx-react-lite';
import * as styles from './Dialog.css';
import { observable, action } from "mobx";
import { appName } from "../store/ThemeStore";

type DialogType = 'alert' | 'confirm';

export interface AlertOptions {
    title?: string;
    icon?: 'error' | 'warning' | 'info';
    okText?: string;
}

export interface ConfirmOptions {
    title?: string;
    yesText?: string;
    noText?: string;
    showCancel?: boolean;
    cancelText?: string;
}

export interface Dialog {
    readonly isOpen: boolean;
    readonly defaultTitle: string;
    alert(message: string, options?: AlertOptions): Promise<void>;
    confirm(message: string, options?: ConfirmOptions): Promise<boolean | null>;
}

class DialogStore implements Dialog {
    readonly defaultTitle = appName;
    @observable accessor type: DialogType = 'alert';
    @observable accessor message: string = '';
    @observable accessor title: string = '';

    // Alert specific
    @observable accessor alertIcon: 'error' | 'warning' | 'info' | undefined = undefined;
    @observable accessor okText: string = 'OK';

    // Confirm specific
    @observable accessor yesText: string = 'OK';
    @observable accessor noText: string = 'Cancel';
    @observable accessor showCancel: boolean = false;
    @observable accessor cancelText: string = 'Cancel';

    dialogRef: React.RefObject<HTMLDialogElement | null> = React.createRef();
    confirmButtonRef: React.RefObject<HTMLButtonElement | null> = React.createRef();
    private resolvePromise: ((value: any) => void) | null = null;
    private pendingResult: any = undefined;
    get isOpen() { return this.dialogRef.current?.open ?? false; }

    @action
    private show(type: DialogType, message: string, options: AlertOptions | ConfirmOptions = {}): Promise<any> {
        //console.log('DialogStore.show', { type, message, options });
        this.type = type;
        this.message = message;
        this.title = options.title || appName;
        this.pendingResult = undefined;

        if (type === 'alert') {
            const opts = options as AlertOptions;
            this.alertIcon = opts.icon;
            this.okText = opts.okText || 'OK';
        } else {
            const opts = options as ConfirmOptions;
            this.yesText = opts.yesText || 'Yes';
            this.noText = opts.noText || 'No';
            this.showCancel = opts.showCancel || false;
            this.cancelText = opts.cancelText || 'Cancel';
        }

        if (this.dialogRef.current) {
            this.dialogRef.current.showModal();
        }

        if (this.confirmButtonRef.current) {
            this.confirmButtonRef.current.focus();
        }

        return new Promise((resolve) => {
            this.resolvePromise = resolve;
        });
    }

    @action
    private close() {
        //console.log('DialogStore.close');
        if (this.dialogRef.current && this.dialogRef.current.open) {
            this.dialogRef.current.close();
        }
    }

    @action
    alert(message: string, options?: AlertOptions): Promise<void> {
        //console.log('DialogStore.alert', message);
        return this.show('alert', message, options);
    }

    @action
    confirm(message: string, options?: ConfirmOptions): Promise<boolean | null> {
        //console.log('DialogStore.confirm', message);
        return this.show('confirm', message, options);
    }

    @action
    handleConfirm = () => {
        //console.log('DialogStore.handleConfirm');
        this.pendingResult = true;
        this.close();
    }

    @action
    handleNo = () => {
        if (this.type === 'confirm') {
            this.pendingResult = false;
        } else {
            this.pendingResult = undefined;
        }
        this.close();
    }

    @action
    handleCancel = () => {
        if (this.type === 'confirm') {
            this.pendingResult = null;
        } else {
            this.pendingResult = undefined;
        }
        this.close();
    }

    // Handles native cancel (Escape key)
    onCancelled = (_e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
        // It's important to prevent default if we want to control the close process? 
        // Or just let it close and set result.
        // Dialog 'close' event fires after this.
        if (this.type === 'confirm') {
            this.pendingResult = null; // Map Escape to null (Cancel)
        } else {
            this.pendingResult = undefined;
        }
    }

    onClosed = () => {
        //console.log('DialogStore.onClosed', { pendingResult: this.pendingResult });
        if (this.resolvePromise) {
            this.resolvePromise(this.pendingResult);
            this.resolvePromise = null;
        }
        this.pendingResult = undefined;
    }

    // Handler for keyboard events within the dialog to support customized navigation if needed
    onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
        if (e.key === 'Escape') {
            // Native behavior handles this usually, but explicit handling ensures our state is correct
            e.stopPropagation();
            // Let native dialog handle closing via Escal
        }
    }
}

const dialogStore = new DialogStore();


export const NativeDialog: React.FC = observer(() => {
    const { type, message, title, alertIcon, okText, yesText, noText, showCancel, cancelText } = dialogStore;

    const defaultTitle = type === 'alert' ? 'Notification' : 'Confirm';
    const displayTitle = title || defaultTitle;

    let iconClass = '';
    if (type === 'alert' && alertIcon) {
        switch (alertIcon) {
            case 'error': iconClass = 'fa-solid fa-circle-exclamation'; break;
            case 'warning': iconClass = 'fa-solid fa-triangle-exclamation'; break;
            case 'info': iconClass = 'fa-solid fa-circle-info'; break;
        }
    } else if (type === 'confirm') {
        iconClass = 'fa-solid fa-circle-question';
    }

    const iconColorMap: Record<string, string> = {
        error: styles.errorIcon,
        warning: styles.warningIcon,
        info: styles.infoIcon
    };

    const iconColorClass = type === 'alert' && alertIcon ? iconColorMap[alertIcon] : styles.confirmIcon;

    return (
        <dialog
            ref={dialogStore.dialogRef}
            className={styles.dialog}
            onCancel={dialogStore.onCancelled}
            onClose={dialogStore.onClosed}
            onKeyDown={dialogStore.onKeyDown}
            data-testid="dialog-overlay"
        >
            <div className={styles.dialogContent}>
                <div className={styles.header} id="dialog-title" data-testid="dialog-title">{displayTitle}</div>
                <div className={styles.body}>
                    {iconClass && (
                        <i
                            className={`${iconClass} ${styles.icon} ${iconColorClass}`}
                            aria-hidden="true"
                            data-testid="dialog-icon"
                        />
                    )}
                    <span className={styles.messageText} data-testid="dialog-message">{message}</span>
                </div>
                <div className={styles.footer}>
                    {type === 'confirm' && showCancel && (
                        <button key="null"
                            className={styles.button}
                            onClick={dialogStore.handleCancel}
                            data-testid="dialog-result-null"
                        >
                            {cancelText}
                        </button>
                    )}
                    {type === 'confirm' && (
                        <button key="false"
                            className={styles.button}
                            onClick={dialogStore.handleNo}
                            data-testid="dialog-result-false"
                        >
                            {noText}
                        </button>
                    )}
                    <button key="true"
                        className={styles.primaryButton}
                        onClick={dialogStore.handleConfirm}
                        ref={dialogStore.confirmButtonRef}
                        data-testid="dialog-result-true"
                    >
                        {type === 'alert' ? okText : yesText}
                    </button>
                </div>
            </div>
        </dialog>
    );
});

export const dialog: Dialog = dialogStore;

// Expose for testing/debugging
if (typeof window !== 'undefined' && window.__TEST_ENABLE_GLOBALS) {
    window.__TEST_dialog = dialog;
}
