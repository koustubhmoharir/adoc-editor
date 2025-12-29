import { makeAutoObservable } from "mobx";

type Theme = 'light' | 'dark';

class ThemeStore {
    theme: Theme = 'light';

    constructor() {
        makeAutoObservable(this);
        const savedTheme = localStorage.getItem('app-theme') as Theme | null;
        if (savedTheme) {
            this.theme = savedTheme;
        }
    }

    toggleTheme = () => {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('app-theme', this.theme);
    }
}

export const themeStore = new ThemeStore();
