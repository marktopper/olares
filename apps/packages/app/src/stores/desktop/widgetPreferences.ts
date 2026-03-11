import { defineStore } from 'pinia';
import { Cookies } from 'quasar';
import { getSecondLevelDomain } from 'src/constant';

export type TimeFormat = '24h' | '12h';
export type DateFormat = 'YYYY/MM/DD' | 'MM/DD/YYYY' | 'MM/DD/YY';

export interface WidgetPreferences {
	timeFormat: TimeFormat;
	dateFormat: DateFormat;
	showCpu: boolean;
	showDisk: boolean;
	showMemory: boolean;
	showShadow: boolean;
}

export const WIDGET_PREFS_COOKIE = 'desktopWidgetPrefs';

export const defaultWidgetPreferences: WidgetPreferences = {
	timeFormat: '24h',
	dateFormat: 'YYYY/MM/DD',
	showCpu: true,
	showDisk: true,
	showMemory: true,
	showShadow: true
};

export type WidgetPreferencesState = WidgetPreferences;

export const useWidgetPreferencesStore = defineStore('widgetPreferences', {
	state: (): WidgetPreferencesState => {
		return { ...defaultWidgetPreferences };
	},
	actions: {
		init() {
			const raw = Cookies.get(WIDGET_PREFS_COOKIE);
			if (raw) {
				try {
					const saved: Partial<WidgetPreferences> = JSON.parse(raw);
					this.timeFormat = saved.timeFormat ?? defaultWidgetPreferences.timeFormat;
					this.dateFormat = saved.dateFormat ?? defaultWidgetPreferences.dateFormat;
					this.showCpu = saved.showCpu ?? defaultWidgetPreferences.showCpu;
					this.showDisk = saved.showDisk ?? defaultWidgetPreferences.showDisk;
					this.showMemory = saved.showMemory ?? defaultWidgetPreferences.showMemory;
					this.showShadow = saved.showShadow ?? defaultWidgetPreferences.showShadow;
				} catch {
					// ignore malformed cookie
				}
			}
		},
		save() {
			const prefs: WidgetPreferences = {
				timeFormat: this.timeFormat,
				dateFormat: this.dateFormat,
				showCpu: this.showCpu,
				showDisk: this.showDisk,
				showMemory: this.showMemory,
				showShadow: this.showShadow
			};
			Cookies.set(WIDGET_PREFS_COOKIE, JSON.stringify(prefs), {
				path: '/',
				domain: getSecondLevelDomain(),
				sameSite: 'None',
				secure: true
			});
		},
		update(prefs: Partial<WidgetPreferences>) {
			if (prefs.timeFormat !== undefined) this.timeFormat = prefs.timeFormat;
			if (prefs.dateFormat !== undefined) this.dateFormat = prefs.dateFormat;
			if (prefs.showCpu !== undefined) this.showCpu = prefs.showCpu;
			if (prefs.showDisk !== undefined) this.showDisk = prefs.showDisk;
			if (prefs.showMemory !== undefined) this.showMemory = prefs.showMemory;
			if (prefs.showShadow !== undefined) this.showShadow = prefs.showShadow;
			this.save();
		}
	}
});
