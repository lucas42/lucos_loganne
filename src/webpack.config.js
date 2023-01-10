import { URL } from 'url';
export default async () => {
	return {
		entry: {
			client: './client/index.js',
		},
		output: {
			filename: '[name].js',
			path: new URL('./resources/', import.meta.url).pathname,
		},
		mode: 'production',
	};
};