import { Bootstrap, Unavailable } from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Share({
	params,
}: {
	params: Promise<{ token: string }>;
}) {
	const { token } = await params;
	return /^[A-Za-z0-9_-]{43}$/.test(token) ? (
		<Bootstrap token={token} />
	) : (
		<Unavailable />
	);
}
