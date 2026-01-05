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
}

export interface Dialog {
    readonly defaultTitle: string;
    alert(message: string, options?: AlertOptions): Promise<void>;
    confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
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

    dialogRef: React.RefObject<HTMLDialogElement> = React.createRef();
    confirmButtonRef: React.RefObject<HTMLButtonElement> = React.createRef();
    private resolvePromise: ((value: any) => void) | null = null;
    private pendingResult: any = undefined;

    @action
    private show(type: DialogType, message: string, options: AlertOptions | ConfirmOptions = {}): Promise<any> {
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
            this.yesText = opts.yesText || 'OK';
            this.noText = opts.noText || 'Cancel';
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
        if (this.dialogRef.current && this.dialogRef.current.open) {
            this.dialogRef.current.close();
        }
    }

    @action
    alert(message: string, options?: AlertOptions): Promise<void> {
        return this.show('alert', message, options);
    }

    @action
    confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
        return this.show('confirm', message, options);
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
    onCancelled = (_e: React.SyntheticEvent<HTMLDialogElement, Event>) => {
        if (this.type === 'confirm') {
            this.pendingResult = false;
        } else {
            this.pendingResult = undefined;
        }
    }

    @action
    onClosed = () => {
        if (this.resolvePromise) {
            this.resolvePromise(this.pendingResult);
            this.resolvePromise = null;
        }
        this.pendingResult = undefined;
    }
}

const dialogStore = new DialogStore();


export const NativeDialog: React.FC = observer(() => {
    const { type, message, title, alertIcon, okText, yesText, noText } = dialogStore;

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
                    {type === 'confirm' && (
                        <button
                            className={styles.button}
                            onClick={dialogStore.handleCancel}
                            data-testid="dialog-cancel-button"
                        >
                            {noText}
                        </button>
                    )}
                    <button
                        className={styles.primaryButton}
                        onClick={dialogStore.handleConfirm}
                        ref={dialogStore.confirmButtonRef}
                        data-testid="dialog-confirm-button"
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
if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
    (window as any).__TEST_dialog = dialog;
}
