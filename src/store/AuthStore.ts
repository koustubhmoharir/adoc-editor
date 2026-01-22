import { action, observable, runInAction } from "mobx";
import { User, UserManager } from "oidc-client-ts";
import { dialog } from "../components/Dialog";

export class AuthStore {

    constructor(authority: string, clientId: string) {
        this.userManager = new UserManager({
            authority: authority,
            client_id: clientId,
            redirect_uri: window.location.origin + "/callback.html",
            popup_redirect_uri: window.location.origin + "/callback.html",
            response_type: 'code',
            scope: 'openid profile email',
            response_mode: "query"
        });
        this.setupEvents();
    }

    private userManager: UserManager;

    private userLoadedCallback = (user: User) => {
        runInAction(() => {
            this.user = user;
        });
    };

    private userUnloadedCallback = () => {
        runInAction(() => {
            this.user = null;
        });
    };

    @observable.ref accessor user: User | null = null;

    private setupEvents() {
        this.userManager.events.addUserLoaded(this.userLoadedCallback);
        this.userManager.events.addUserUnloaded(this.userUnloadedCallback);
    }

    @action
    cleanup() {
        this.userManager.events.removeUserLoaded(this.userLoadedCallback);
        this.userManager.events.removeUserUnloaded(this.userUnloadedCallback);
    }

    @action
    async login() {
        try {
            await this.userManager.signinPopup();
        } catch (err: any) {
            dialog.alert(`Login failed ${err.message ?? ""}`, { icon: "error" });
        }
    }

    @action
    async logout() {
        try {
            await this.userManager.signoutPopup(); // or signoutPopup
        } catch (err) {
            console.error("Logout failed", err);
        }
    }
}
