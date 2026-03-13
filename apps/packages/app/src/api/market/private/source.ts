import { useCenterStore } from 'src/stores/market/center';
import { MarketSource } from 'src/constant/constants';
import axios from 'axios';

export interface MarketRequest {
	id: string;
	name: string;
	base_url: string;
	type: string;
	description: string;
}

export async function getMarketSource(): Promise<MarketSource[]> {
	const store = useCenterStore();
	const url = store.appUrl + '/settings/market-source';
	const { data } = await axios.get(url);
	console.log(data);
	return data ?? [];
}

export async function addMarketSource(
	request: MarketRequest
): Promise<MarketSource[]> {
	const store = useCenterStore();
	const url = store.appUrl + '/settings/market-source';
	const { data } = await axios.post(url, request);
	console.log(data);
	return data;
}

export async function deleteMarketSource(sourceId: string): Promise<any> {
	const store = useCenterStore();
	const url = store.appUrl + `/settings/market-source/${sourceId}`;
	const { data } = await axios.delete(url);
	console.log(data);
	return data;
}
