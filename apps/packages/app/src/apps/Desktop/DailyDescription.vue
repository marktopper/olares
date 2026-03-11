<template>
	<div class="description_box">
		<div class="description_weather">
			<div
				class="description_time"
				:class="{ 'no-shadow': !widgetPrefsStore.showShadow }"
			>
				{{ state.time
				}}<span v-if="widgetPrefsStore.timeFormat === '12h'" class="description_ampm">{{
					state.ampm
				}}</span>
			</div>
			<div class="description_daily">
				<div class="description_singapore">
					<p
						class="description_week"
						:class="{ 'no-shadow': !widgetPrefsStore.showShadow }"
					>
						{{ state.week }}
					</p>
					<p
						class="description_day"
						:class="{ 'no-shadow': !widgetPrefsStore.showShadow }"
					>
						{{ state.date }}
					</p>
				</div>
			</div>
		</div>
		<div
			v-if="visibleUsages.length > 0"
			class="description_thickness"
		>
			<div
				class="description_track"
				v-for="(item, index) in visibleUsages"
				:key="`d` + index"
			>
				<q-knob
					readonly
					v-model="item.ratio"
					font-size="80px"
					size="24px"
					:thickness="0.5"
					:color="item.color"
					track-color="grey-4"
				></q-knob>
				<div
					class="description_track_txt"
					:class="{ 'no-shadow': !widgetPrefsStore.showShadow }"
				>
					<p class="text-uppercase">{{ item.name }}</p>
					<p>{{ item.ratio }}%</p>
				</div>
			</div>
		</div>
	</div>
</template>
<script lang="ts" setup>
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue';

import { useMonitorStore } from '../../stores/desktop/monitor';
import { useWidgetPreferencesStore } from '../../stores/desktop/widgetPreferences';

const monitorStore = useMonitorStore();
const widgetPrefsStore = useWidgetPreferencesStore();
const watchTimeTask = ref();
const state = reactive({
	date: '',
	time: '',
	week: '',
	ampm: '',
	showIndex: 0,
	isAM: false,
	show: true
});

const visibleUsages = computed(() => {
	return monitorStore.usages.filter((item) => {
		if (item.name === 'cpu') return widgetPrefsStore.showCpu;
		if (item.name === 'disk') return widgetPrefsStore.showDisk;
		if (item.name === 'memory') return widgetPrefsStore.showMemory;
		return true;
	});
});

const getTime = async () => {
	var myDate = new Date();
	let hours = myDate.getHours();
	let minutes = myDate.getMinutes().toString().padStart(2, '0');
	let year = myDate.getFullYear().toString();
	let month = (myDate.getMonth() + 1).toString().padStart(2, '0');
	let day = myDate.getDate().toString().padStart(2, '0');

	if (widgetPrefsStore.dateFormat === 'MM/DD/YYYY') {
		state.date = `${month}/${day}/${year}`;
	} else if (widgetPrefsStore.dateFormat === 'MM/DD/YY') {
		state.date = `${month}/${day}/${year.slice(-2)}`;
	} else {
		state.date = `${year}/${month}/${day}`;
	}

	if (widgetPrefsStore.timeFormat === '12h') {
		const ampm = hours >= 12 ? 'PM' : 'AM';
		const hour12 = hours % 12 || 12;
		state.time = hour12.toString().padStart(2, '0') + ':' + minutes;
		state.ampm = ampm;
		state.isAM = hours < 12;
	} else {
		state.time = hours.toString().padStart(2, '0') + ':' + minutes;
		state.ampm = '';
		state.isAM = hours < 12;
	}

	state.show = false;
	await nextTick();
	state.show = true;
};

const getWeekDate = () => {
	var now = new Date();
	var day = now.getDay();
	var weeks = [
		'Sunday',
		'Monday',
		'Tuesday',
		'Wednesday',
		'Thursday',
		'Friday',
		'Saturday'
	];
	state.week = weeks[day];
};

const watchTime = () => {
	watchTimeTask.value = setInterval(() => {
		getWeekDate();
		getTime();
	}, 1000 * 1);
	getWeekDate();
	getTime();
};

onMounted(() => {
	widgetPrefsStore.init();
	watchTime();
	monitorStore.loadMonitor();
});

onUnmounted(() => {
	clearInterval(watchTimeTask.value);
});
</script>

<style lang="scss">
.description_box {
	position: absolute;
	bottom: 122px;
	right: 165px;
	.description_weather {
		height: 72px;
		display: flex;
		.description_time {
			font-size: 70px;
			font-family: Roboto-Bold, Roboto;
			font-weight: bold;
			color: #ffffff;
			line-height: 72px;
			text-shadow: 0px 2px 6px rgba(0, 0, 0, 0.16);
			display: flex;
			align-items: flex-end;
			&.no-shadow {
				text-shadow: none;
			}
			.description_ampm {
				font-size: 20px;
				font-weight: bold;
				line-height: 1;
				margin-left: 6px;
				margin-bottom: 8px;
			}
		}
		.description_daily {
			display: flex;
			padding-top: 14px;
			margin-left: 14px;
			p {
				margin: 0;
			}
			.description_singapore {
				.description_week {
					font-size: 20px;
					font-family: Roboto-Bold, Roboto;
					font-weight: bold;
					color: #ffffff;
					text-shadow: 0px 2px 6px rgba(0, 0, 0, 0.16);
					&.no-shadow {
						text-shadow: none;
					}
				}
				.description_day {
					font-size: 12px;
					font-family: Roboto-Regular, Roboto;
					font-weight: 400;
					color: #ffffff;
					text-shadow: 0px 2px 6px rgba(0, 0, 0, 0.16);
					&.no-shadow {
						text-shadow: none;
					}
				}
			}
		}
	}
	.description_thickness {
		display: flex;
		margin-top: 15px;
		justify-content: space-between;
		.q-circular-progress__track {
			color: rgba(255, 255, 255, 0.46) !important;
		}
		.description_track {
			display: flex;
			opacity: 0.8;
			p {
				margin: 0px;
			}
			.description_track_txt {
				font-size: 12px;
				font-family: Roboto-Regular, Roboto;
				font-weight: 400;
				color: #ffffff;
				line-height: 12px;
				text-shadow: 0px 2px 6px rgba(0, 0, 0, 0.16);
				margin-left: 8px;
				&.no-shadow {
					text-shadow: none;
				}
			}
		}
	}
}
</style>
