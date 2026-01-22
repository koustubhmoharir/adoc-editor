import { action, observable, runInAction } from "mobx";
import { User, UserManager } from "oidc-client-ts";

export class AuthStore {
    private userManager: UserManager;

    private userLoadedCallback = (user: User) => {
        runInAction(() => {
            this.user = user;
            this.isAuthenticated = true;
        });
    };

    private userUnloadedCallback = () => {
        runInAction(() => {
            this.user = null;
            this.isAuthenticated = false;
        });
    };

    @observable.ref accessor user: User | null = null;
    @observable accessor isAuthenticated: boolean = false;
    @observable accessor isLoading: boolean = true;
    @observable accessor error: string | null = null;
    @observable accessor isConfigured: boolean = false;

    constructor(authority: string, clientId: string) {
        this.isConfigured = !!authority && !!clientId;

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
        this.error = null;
        try {
            if (!this.isConfigured) {
                alert("AuthStore is not configured.");
                return;
            }

            await this.userManager.signinPopup();
        } catch (err: any) {
            console.error("Login failed", err);
            runInAction(() => {
                this.error = err.message;
            });
        }
    }

    @action
    async logout() {
        try {
            await this.userManager.signoutRedirect(); // or signoutPopup
        } catch (err) {
            console.error("Logout failed", err);
        }
    }
}
