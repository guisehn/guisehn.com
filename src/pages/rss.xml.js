import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
	const posts = await getCollection('blog');
	return rss({
		title: "Gui Sehn",
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/${post.slug}/`,
		})),
	});
}
