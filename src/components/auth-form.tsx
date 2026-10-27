"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ProductEntry } from "./product-entry";
import { motionDuration } from "./ui-motion";
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
			setShowPassword(false);
			setOtp("");
			setMode(next);
			setLeaving(false);
		};
		if (!motionDuration("exit")) commit();
		else {
			setLeaving(true);
			transition.current = setTimeout(commit, motionDuration("exit"));
		}
	}
	const [email, setEmail] = useState(""),
		[password, setPassword] = useState(""),
		[otp, setOtp] = useState("");
	const [busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const submitting = useRef(false);
	async function submit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (submitting.current) return;
		submitting.current = true;
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
			submitting.current = false;
			setBusy(false);
		}
	}
	return (
		<ProductEntry>
			<div
				key={mode}
				className="pm-form-state"
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
						: mode === "register"
							? "创建账号，开始整理项目资料与交付成果。"
							: "继续整理资料，与客户清楚交接。"}
				</p>
				<form
					method="post"
					onSubmit={submit}
					className="pm-auth-form"
					aria-busy={busy}
					aria-describedby={error ? "auth-error" : undefined}
				>
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
						<div className="pm-field">
							<label htmlFor="auth-password">密码</label>
							<span className="pm-password">
								<input
									id="auth-password"
									type={showPassword ? "text" : "password"}
									name="password"
									value={password}
									autoComplete={
										mode === "login" ? "current-password" : "new-password"
									}
									minLength={12}
									maxLength={128}
									required
									disabled={busy}
									aria-describedby={
										mode === "register" ? "auth-password-help" : undefined
									}
									onChange={(e) => setPassword(e.target.value)}
								/>
								<button
									type="button"
									disabled={busy}
									aria-label={showPassword ? "隐藏密码" : "显示密码"}
									aria-pressed={showPassword}
									onClick={() => setShowPassword((value) => !value)}
								>
									{showPassword ? "隐藏" : "显示"}
								</button>
							</span>
							{mode === "register" ? (
								<small id="auth-password-help">
									至少 12 位；注册后需用邮件中的数字验证码确认邮箱。
								</small>
							) : null}
						</div>
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
						<p id="auth-error" role="alert" className="pm-notice error">
							{error}
						</p>
					) : null}
					<button type="submit" className="primary pm-busy" disabled={busy}>
						{busy
							? mode === "login"
								? "正在登录…"
								: mode === "register"
									? "正在发送验证码…"
									: "正在确认邮箱…"
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
					<div className="pm-auth-support">
						<p className="muted">未收到邮件？先检查垃圾邮件；请勿连续注册。</p>
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
					</div>
				)}
				<div className="pm-auth-foot">
					<p>客户无需注册</p>
					<p className="muted">请打开工程师发送的项目链接。</p>
				</div>
			</div>
		</ProductEntry>
	);
}
