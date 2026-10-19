"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { EntryShell } from "./entry-shell";
export function AuthForm() {
	const [mode, setMode] = useState<"login" | "register" | "verify">("login");
	const [leaving, setLeaving] = useState(false);
	const transition = useRef<ReturnType<typeof setTimeout> | null>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const previousMode = useRef(mode);
	useEffect(
		() => () => {
			if (transition.current) clearTimeout(transition.current);
		},
		[],
	);
	useEffect(() => {
		if (previousMode.current !== mode) heading.current?.focus();
		previousMode.current = mode;
	}, [mode]);
	function switchMode(next: typeof mode) {
		if (transition.current) return;
		const commit = () => {
			transition.current = null;
			setError("");
			setPassword("");
			setOtp("");
			setMode(next);
			setLeaving(false);
		};
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) commit();
		else {
			setLeaving(true);
			transition.current = setTimeout(commit, 130);
		}
	}
	const [email, setEmail] = useState(""),
		[password, setPassword] = useState(""),
		[otp, setOtp] = useState("");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	async function submit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusy(true);
		setError("");
		try {
			await api(
				`/api/auth/${mode}`,
				"POST",
				mode === "verify" ? { email, token: otp } : { email, password },
			);
			if (mode === "register") {
				setPassword("");
				switchMode("verify");
			} else window.location.assign("/projects");
		} catch (e) {
			setError(e instanceof Error ? e.message : "网络中断，请重试。");
		} finally {
			setBusy(false);
		}
	}
	return (
		<EntryShell
			eyebrow="工程师入口"
			title="每份资料，都有清楚的去处。"
			description="整理项目，标注测量位置，将成果交给客户。"
		>
			<div
				key={mode}
				className="entry-form-state"
				data-phase={leaving ? "closing" : "open"}
				inert={leaving}
			>
				<h1 ref={heading} tabIndex={-1}>
					{mode === "login"
						? "工程师登录"
						: mode === "register"
							? "创建工程师账号"
							: "确认邮箱"}
				</h1>
				<p className="muted">
					{mode === "verify"
						? "输入邮件中的数字验证码，确认后即可使用邮箱和密码登录。"
						: "整理零件资料，与客户清楚地交接。"}
				</p>
				<form onSubmit={submit} className="stack" aria-busy={busy}>
					<label>
						邮箱
						<input
							type="email"
							name="email"
							value={email}
							autoComplete="email"
							required
							disabled={busy || mode === "verify"}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</label>
					{mode !== "verify" ? (
						<label>
							密码
							<input
								type="password"
								name="password"
								value={password}
								autoComplete={
									mode === "login" ? "current-password" : "new-password"
								}
								minLength={12}
								maxLength={128}
								required
								disabled={busy}
								onChange={(e) => setPassword(e.target.value)}
							/>
							<small>至少 12 位；注册后需确认邮箱。</small>
						</label>
					) : (
						<label>
							数字验证码
							<input
								name="otp"
								inputMode="numeric"
								autoComplete="one-time-code"
								pattern="[0-9]{6,10}"
								minLength={6}
								maxLength={10}
								value={otp}
								required
								disabled={busy}
								onChange={(e) => setOtp(e.target.value)}
							/>
						</label>
					)}
					{error ? (
						<p role="alert" className="error">
							{error}
						</p>
					) : null}
					<button type="submit" className="primary" disabled={busy}>
						{busy
							? "正在处理…"
							: mode === "login"
								? "登录"
								: mode === "register"
									? "注册并发送验证码"
									: "确认邮箱"}
					</button>
				</form>
				{mode !== "verify" ? (
					<button
						type="button"
						className="text-button"
						disabled={busy}
						onClick={() => {
							switchMode(mode === "login" ? "register" : "login");
						}}
					>
						{mode === "login" ? "没有账号？注册" : "已有账号？登录"}
					</button>
				) : (
					<p>
						未收到邮件？先检查垃圾邮件；请勿连续注册。
						<button
							type="button"
							className="text-button"
							disabled={busy}
							onClick={() => {
								switchMode("login");
							}}
						>
							返回登录
						</button>
					</p>
				)}
				<p className="muted">客户无需注册，请直接打开工程师分享的链接。</p>
			</div>
		</EntryShell>
	);
}
