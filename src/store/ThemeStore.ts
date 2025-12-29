import { observable, action } from "mobx";

type Theme = 'light' | 'dark';

class ThemeStore {
    @observable accessor theme: Theme = 'light';

    constructor() {
        const savedTheme = localStorage.getItem('app-theme') as Theme | null;
        if (savedTheme) {
            this.theme = savedTheme;
        }
    }

    @action
    toggleTheme = () => {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('app-theme', this.theme);
    }
}

export const themeStore = new ThemeStore();
