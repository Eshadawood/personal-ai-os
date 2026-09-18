import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { BrainCircuit, CheckCircle2, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";

function friendlyAuthError(error: unknown, mode: "login" | "signup") {
  const code = (error as { data?: { code?: string } })?.data?.code;
  if (code === "UNAUTHORIZED") return "Invalid email or password.";
  if (code === "CONFLICT") return "An account with that email already exists. Try signing in instead.";
  if (code === "PRECONDITION_FAILED") return "Account services are temporarily unavailable. Please try again shortly.";
  if (mode === "signup") return "We couldn't create your account. Check your details and try again.";
  return "We couldn't sign you in. Check your details and try again.";
}

export default function LoginPage({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, refresh } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!authLoading && user) setLocation("/app");
  }, [authLoading, setLocation, user]);

  const login = trpc.auth.login.useMutation({
    onSuccess: async () => { await refresh(); setLocation("/app"); },
    onError: error => setErrorMessage(friendlyAuthError(error, "login")),
  });
  const signup = trpc.auth.signup.useMutation({
    onSuccess: async () => { await refresh(); setLocation("/app"); },
    onError: error => setErrorMessage(friendlyAuthError(error, "signup")),
  });
  const pending = login.isPending || signup.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    if (mode === "login") login.mutate({ email, password });
    else signup.mutate({ name, email, password });
  }

  if (authLoading || user) {
    return <div className="grid min-h-screen place-items-center bg-[#070b12] text-sm text-slate-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking your session…</div>;
  }

  return <main className="relative min-h-screen overflow-hidden bg-[#070b12] text-slate-100">
    <div className="pointer-events-none absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-cyan-400/[0.08] blur-3xl" />
    <div className="pointer-events-none absolute -bottom-64 -right-32 h-[36rem] w-[36rem] rounded-full bg-violet-500/[0.08] blur-3xl" />
    <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-[1fr_460px] lg:px-10">
      <section className="hidden max-w-xl lg:block">
        <div className="mb-10 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-300 to-blue-500 text-slate-950 shadow-[0_0_35px_rgba(34,211,238,0.25)]"><BrainCircuit className="h-6 w-6" /></span><div><p className="text-lg font-bold tracking-tight text-white">Personal AI OS</p><p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Agentic workspace</p></div></div>
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">Your private operating system</p>
        <h1 className="max-w-lg text-5xl font-semibold leading-[1.05] tracking-[-0.055em] text-white">Turn intent into <span className="text-cyan-300">forward motion.</span></h1>
        <p className="mt-6 max-w-md text-base leading-7 text-slate-400">Plan, research, organize, and execute from one calm workspace built around your goals.</p>
        <div className="mt-10 grid gap-3 text-sm text-slate-300"><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-lime-300" />Planner and Critic workflows</div><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-lime-300" />Private goals, tasks, memory, and chat</div><div className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-lime-300" />AI assistance that keeps you in control</div></div>
      </section>
      <section className="mx-auto w-full max-w-[460px]">
        <div className="mb-8 flex items-center gap-3 lg:hidden"><span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-500 text-slate-950"><BrainCircuit className="h-5 w-5" /></span><div><p className="font-bold text-white">Personal AI OS</p><p className="text-[9px] uppercase tracking-[0.22em] text-slate-500">Agentic workspace</p></div></div>
        <div className="rounded-3xl border border-white/[0.1] bg-[#0c1420]/90 p-6 shadow-[0_24px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
          <div className="mb-7"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">Private workspace</p><h2 className="text-2xl font-semibold tracking-tight text-white">{mode === "login" ? "Welcome back" : "Create your workspace"}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{mode === "login" ? "Sign in to continue to your Personal AI OS." : "Start building a private system for your goals and work."}</p></div>
          {errorMessage && <div role="alert" className="mb-4 rounded-xl border border-rose-300/20 bg-rose-300/[0.08] px-3 py-2.5 text-sm text-rose-200">{errorMessage}</div>}
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-400">Name</span><input required minLength={2} value={name} onChange={e => setName(e.target.value)} autoComplete="name" className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" placeholder="Alex Morgan" /></label>}
            <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-400">Email</span><input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" placeholder="you@example.com" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium text-slate-400">Password</span><input required type="password" minLength={mode === "signup" ? 10 : 1} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} className="w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10" placeholder={mode === "signup" ? "At least 10 characters" : "Your password"} /></label>
            <button disabled={pending} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{pending && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-slate-600"><span className="h-px flex-1 bg-white/[0.08]" />or<span className="h-px flex-1 bg-white/[0.08]" /></div>
          <button type="button" onClick={() => startLogin()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.06]"><span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[11px] font-bold text-slate-900">G</span>Continue with Google</button>
          <div className="mt-6 flex items-center justify-between text-xs"><button type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setErrorMessage(""); }} className="font-semibold text-cyan-300 hover:text-cyan-200">{mode === "login" ? "Create account" : "Back to sign in"}</button>{mode === "login" && <span className="text-slate-600">Forgot password? Contact your workspace admin.</span>}</div>
        </div>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-[11px] text-slate-600"><LockKeyhole className="h-3.5 w-3.5" />Your workspace data is protected by your account session.</p>
      </section>
    </div>
  </main>;
}
