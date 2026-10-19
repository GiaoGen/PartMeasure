export function searchProjects<T extends { name: string; description: string }>(
	projects: readonly T[],
	query: string,
): readonly T[] {
	const term = query.trim().toLowerCase();
	if (!term) return projects;
	return projects.filter(
		(project) =>
			project.name.toLowerCase().includes(term) ||
			project.description.toLowerCase().includes(term),
	);
}
