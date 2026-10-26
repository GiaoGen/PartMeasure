"use client";
import { ProjectEntryLoading } from "@/components/project-entry-loading";
export default function ErrorPage({
	retry,
}: {
	error: unknown;
	retry: () => void;
}) {
	return (
		<ProjectEntryLoading
			error="请重试，或重新登录后进入项目列表。"
			retry={retry}
		/>
	);
}
