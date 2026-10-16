import { Unavailable, Workspace } from "@/components/workspace";
import { guest } from "@/lib/server/auth";
import { uuid } from "@/lib/server/http";
import { projectDetail } from "@/lib/server/service";
export const dynamic = "force-dynamic";
export default async function GuestPage({
	searchParams,
}: {
	searchParams: Promise<{ project?: string }>;
}) {
	const { project } = await searchParams;
	if (!project || !uuid.safeParse(project).success) return <Unavailable />;
	try {
		return (
			<Workspace
				initial={await projectDetail(await guest(project), project)}
				guest
			/>
		);
	} catch {
		return <Unavailable />;
	}
}
