import { ImageTransfers } from "./image-transfers";
/** Two outstanding uploads per actor/project, one server-processing request across this tab. */
export class UploadPipeline {
	private projects = new Map<string, { jobs: ImageTransfers; starts: number[] }>();
	private processing = new ImageTransfers(1, 40);
	private project(base: string) {
		let project = this.projects.get(base);
		if (!project) { project = { jobs: new ImageTransfers(2, 40), starts: [] }; this.projects.set(base, project); }
		return project;
	}
	run<T>(base: string, signal: AbortSignal, work: () => Promise<T>) { return this.project(base).jobs.run(signal, work); }
	finish<T>(signal: AbortSignal, work: () => Promise<T>) { return this.processing.run(signal, work); }
	async reservation<T>(base: string, signal: AbortSignal, work: () => Promise<T>) {
		const project = this.project(base);
		while (true) {
			signal.throwIfAborted();
			project.starts = project.starts.filter(at => at > Date.now() - 61000);
			if (project.starts.length < 10) break;
			await uploadPause(Math.max(1, (project.starts[0] ?? Date.now()) + 61000 - Date.now()), signal);
		}
		project.starts.push(Date.now());
		return work();
	}
}
export function uploadPause(ms: number, signal: AbortSignal) {
	return new Promise<void>((resolve, reject) => {
		signal.throwIfAborted();
		const cancel = () => { clearTimeout(timer); reject(signal.reason); };
		const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
		signal.addEventListener("abort", cancel, { once: true });
	});
}
export const uploadPipeline = new UploadPipeline();
