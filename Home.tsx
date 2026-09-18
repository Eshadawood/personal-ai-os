import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  ArrowUpRight,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Command,
  FileText,
  Flag,
  FolderKanban,
  Gauge,
  Inbox,
  LayoutDashboard,
  Library,
  ListChecks,
  Lock,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Target,
  TerminalSquare,
  Timer,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type PageKey = "overview" | "chat" | "goals" | "tasks" | "memory" | "files" | "agents" | "activity" | "tools" | "settings";
type DemoTask = { id: number; title: string; description: string; status: "todo" | "in_progress" | "completed"; priority: "low" | "medium" | "high"; agent: string; goalId?: number | null };
type DemoGoal = { id: number; title: string; description: string | null; status: "active" | "completed" | "paused"; priority: "low" | "medium" | "high"; progress: number };
type DemoEvent = { id: number; title: string; description: string | null; eventType: string; agent: string | null; createdAt: Date };

const navGroups = [
  { label: "Workspace", items: [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "chat", label: "Chat", icon: MessageCircle },
    { key: "goals", label: "Goals", icon: Target },
    { key: "tasks", label: "Tasks", icon: ListChecks },
  ] },
  { label: "Context", items: [
    { key: "memory", label: "Memory", icon: BrainCircuit },
    { key: "files", label: "Files", icon: FileText },
  ] },
  { label: "System", items: [
    { key: "agents", label: "Agents", icon: Network },
    { key: "activity", label: "Activity", icon: Activity },
    { key: "tools", label: "Tools", icon: TerminalSquare },
  ] },
];

const demoGoals: DemoGoal[] = [
  { id: 1, title: "Land an AI Engineer role", description: "Build a focused portfolio and interview loop for the next opportunity.", status: "active", priority: "high", progress: 62 },
  { id: 2, title: "Ship personal knowledge base", description: "Turn scattered notes into a searchable operating system.", status: "active", priority: "medium", progress: 38 },
  { id: 3, title: "Strengthen systems design", description: "Practice architecture decisions with real constraints.", status: "active", priority: "medium", progress: 24 },
];
const demoTasks: DemoTask[] = [
  { id: 1, title: "Research the top AI companies hiring now", description: "Compare role expectations and hiring signals.", status: "completed", priority: "high", agent: "Research Agent", goalId: 1 },
  { id: 2, title: "Update the impact section of your CV", description: "Rewrite two bullets with measurable outcomes.", status: "in_progress", priority: "high", agent: "Task Agent", goalId: 1 },
  { id: 3, title: "Create an agentic AI interview study plan", description: "Sequence RAG, evals, and orchestration topics.", status: "todo", priority: "medium", agent: "Planner Agent", goalId: 1 },
  { id: 4, title: "Index the Q3 project report", description: "Add the document to your personal retrieval context.", status: "todo", priority: "low", agent: "File Agent", goalId: 2 },
];
const demoEvents: DemoEvent[] = [
  { id: 1, title: "Critic verified research", description: "12 sources passed quality checks", eventType: "verified", agent: "Critic Agent", createdAt: new Date(Date.now() - 11 * 60000) },
  { id: 2, title: "Research Agent finished", description: "Synthesized hiring signals from 12 sources", eventType: "agent", agent: "Research Agent", createdAt: new Date(Date.now() - 18 * 60000) },
  { id: 3, title: "Planner generated 6 tasks", description: "Dependencies mapped to the interview goal", eventType: "plan", agent: "Planner Agent", createdAt: new Date(Date.now() - 34 * 60000) },
  { id: 4, title: "Goal progress updated", description: "AI Engineer role preparation is at 62%", eventType: "goal", agent: "Task Agent", createdAt: new Date(Date.now() - 49 * 60000) },
];

const stageLabels = ["Understanding request", "Creating execution plan", "Routing specialist agents", "Critic reviewing output"];

function initials(name?: string | null) {
  return (name || "Alex Morgan").split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatRelative(date: Date | string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

function formatToday() {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "lime" | "blue" | "amber" | "slate" | "pink" }) {
  const styles = { lime: "bg-lime-400/10 text-lime-300 border-lime-400/20", blue: "bg-cyan-400/10 text-cyan-300 border-cyan-400/20", amber: "bg-amber-300/10 text-amber-200 border-amber-300/20", slate: "bg-white/[0.06] text-slate-300 border-white/10", pink: "bg-fuchsia-400/10 text-fuchsia-200 border-fuchsia-400/20" };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.13em] ${styles[tone]}`}>{children}</span>;
}

function SectionHeader({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex items-end justify-between gap-4"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">{eyebrow}</p><h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>{detail && <p className="mt-1 text-sm text-slate-400">{detail}</p>}</div>{action}</div>;
}

export default function Home() {
  const { user, loading: authLoading, isAuthenticated, logout, refresh } = useAuth();
  const [, setLocation] = useLocation();
  const [page, setPage] = useState<PageKey>(() => {
    const segment = window.location.pathname.split("/").filter(Boolean).pop();
    return (segment && segment !== "app" ? segment : "overview") as PageKey;
  });
  const [prompt, setPrompt] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowPrompt, setWorkflowPrompt] = useState("");
  const [stage, setStage] = useState(0);
  const [localTasks, setLocalTasks] = useState(demoTasks);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const authMutation = trpc.auth.login.useMutation({ onSuccess: () => { refresh(); toast.success("Welcome back"); }, onError: error => toast.error(error.message) });
  const signupMutation = trpc.auth.signup.useMutation({ onSuccess: () => { refresh(); toast.success("Account created"); }, onError: error => toast.error(error.message) });

  const dashboardQuery = trpc.dashboard.get.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const workflow = trpc.dashboard.runWorkflow.useMutation({
    onSuccess: result => {
      setStage(3);
      toast.success(`Plan ready with ${result.taskCount} tasks`);
      dashboardQuery.refetch();
    },
    onError: error => {
      setWorkflowOpen(false);
      toast.error(error.message || "The workflow could not complete.");
    },
  });
  const toggleTask = trpc.dashboard.toggleTask.useMutation({ onSuccess: () => dashboardQuery.refetch() });

  useEffect(() => {
    if (!workflowOpen || workflow.isPending) return;
    setStage(0);
  }, [workflowOpen, workflow.isPending]);
  useEffect(() => {
    if (!workflow.isPending) return;
    const timer = window.setInterval(() => setStage(current => Math.min(current + 1, stageLabels.length - 1)), 900);
    return () => window.clearInterval(timer);
  }, [workflow.isPending]);

  const liveGoals = (dashboardQuery.data?.goals ?? (isAuthenticated ? [] : demoGoals)) as DemoGoal[];
  const liveTasks = (dashboardQuery.data?.tasks ?? (isAuthenticated ? [] : localTasks)) as DemoTask[];
  const liveEvents = (dashboardQuery.data?.activity ?? (isAuthenticated ? [] : demoEvents)) as DemoEvent[];
  const activeGoal = liveGoals[0];
  const completedTasks = liveTasks.filter(task => task.status === "completed").length;
  const firstName = (user?.name || "Alex").split(" ")[0];

  function navigate(next: PageKey) {
    setPage(next);
    setMobileOpen(false);
    setLocation(next === "overview" ? "/app" : `/app/${next}`);
  }

  function submitPrompt(value = prompt) {
    if (!value.trim()) return;
    if (!isAuthenticated) {
      toast("Sign in to run an autonomous workflow", { description: "Your plan, tasks, and memories will be saved to your private workspace." });
      return;
    }
    setWorkflowOpen(true);
    setWorkflowPrompt(value.trim());
    setStage(0);
    workflow.mutate({ prompt: value.trim() });
    setPrompt("");
  }

  function toggleLocalTask(id: number) {
    if (isAuthenticated) {
      const current = liveTasks.find(task => task.id === id);
      if (current) toggleTask.mutate({ id, completed: current.status !== "completed" });
      return;
    }
    setLocalTasks(tasks => tasks.map(task => task.id === id ? { ...task, status: task.status === "completed" ? "todo" : "completed" } : task));
  }

  const view = useMemo(() => {
    if (page === "goals") return <GoalsView goals={liveGoals} />;
    if (page === "chat") return <ChatView isAuthenticated={isAuthenticated} />;
    if (page === "tasks") return <TasksView tasks={liveTasks} onToggle={toggleLocalTask} />;
    if (page === "memory") return <MemoryView />;
    if (page === "files") return <FilesView />;
    if (page === "agents") return <AgentsView />;
    if (page === "activity") return <ActivityView events={liveEvents} />;
    if (page === "tools") return <ToolsView />;
    if (page === "settings") return <SettingsView user={user?.name || "Alex Morgan"} onLogout={() => { void logout().finally(() => setLocation("/login")); }} />;
    return <OverviewView firstName={firstName} prompt={prompt} setPrompt={setPrompt} submitPrompt={submitPrompt} goals={liveGoals} tasks={liveTasks} events={liveEvents} activeGoal={activeGoal} completedTasks={completedTasks} onToggle={toggleLocalTask} onNavigate={navigate} />;
  }, [page, prompt, liveGoals, liveTasks, liveEvents, activeGoal, completedTasks, isAuthenticated, user?.name, workflowPrompt]);

  return <div className="min-h-screen bg-[#070b12] text-slate-100 selection:bg-cyan-300 selection:text-slate-950">
    <div className="pointer-events-none fixed inset-0 overflow-hidden"><div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-cyan-400/[0.06] blur-3xl" /><div className="absolute -bottom-56 right-0 h-[34rem] w-[34rem] rounded-full bg-fuchsia-500/[0.04] blur-3xl" /></div>
    <div className="relative flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-50 w-[260px] border-r border-white/[0.08] bg-[#090e17]/95 px-4 py-5 backdrop-blur-xl transition-transform lg:static lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-2"><button className="group flex items-center gap-3 text-left" onClick={() => navigate("overview")}><span className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-blue-500 text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.22)]"><BrainCircuit className="h-5 w-5" /><span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-lime-300 shadow-[0_0_10px_rgba(190,242,100,0.9)]" /></span><span><span className="block text-sm font-bold tracking-tight text-white">Personal AI OS</span><span className="block text-[9px] uppercase tracking-[0.24em] text-slate-500">Agentic workspace</span></span></button><button className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)}><X className="h-4 w-4" /></button></div>
        <div className="my-7 h-px bg-white/[0.07]" />
        <nav className="space-y-6">{navGroups.map(group => <div key={group.label}><p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-600">{group.label}</p><div className="space-y-1">{group.items.map(item => { const Icon = item.icon; const active = page === item.key; return <button key={item.key} onClick={() => navigate(item.key as PageKey)} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${active ? "bg-cyan-300/[0.11] text-cyan-200 shadow-[inset_2px_0_0_#67e8f9]" : "text-slate-400 hover:bg-white/[0.045] hover:text-white"}`}><Icon className={`h-4 w-4 ${active ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300"}`} /><span>{item.label}</span>{item.key === "tasks" && <span className="ml-auto rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-slate-400">{liveTasks.filter(t => t.status !== "completed").length}</span>}</button> })}</div></div>)}</nav>
        <div className="absolute bottom-5 left-4 right-4"><button onClick={() => navigate("settings")} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${page === "settings" ? "bg-white/[0.06] text-white" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"}`}><Settings2 className="h-4 w-4" />Settings</button><div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 text-[11px] font-bold text-white">{initials(user?.name)}</div><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-200">{user?.name || "Demo workspace"}</p><p className="truncate text-[10px] text-slate-500">{isAuthenticated ? "Private workspace" : "Preview mode"}</p></div><span className="ml-auto h-1.5 w-1.5 rounded-full bg-lime-300" /></div></div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/60 lg:hidden" />}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-white/[0.07] bg-[#070b12]/80 px-5 backdrop-blur-xl sm:px-8"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"><Menu className="h-5 w-5" /></button><div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><Command className="h-3.5 w-3.5" /><span>Workspace</span><ChevronRight className="h-3 w-3" /><span className="text-slate-300">{page === "overview" ? "Overview" : page[0].toUpperCase() + page.slice(1)}</span></div><div className="sm:hidden"><p className="text-sm font-semibold text-white">{page === "overview" ? "Overview" : page[0].toUpperCase() + page.slice(1)}</p></div></div><div className="flex items-center gap-3"><button onClick={() => toast("Command palette", { description: "Keyboard shortcuts are coming to your workspace." })} className="hidden items-center gap-2 rounded-lg border border-white/[0.09] bg-white/[0.03] px-3 py-2 text-xs text-slate-500 transition hover:border-white/20 hover:text-slate-300 md:flex"><Search className="h-3.5 w-3.5" />Search<span className="ml-3 rounded border border-white/10 px-1.5 py-0.5 text-[9px]">⌘ K</span></button><button onClick={() => submitPrompt("Plan my week around the highest impact work") } className="hidden items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-200 active:scale-[0.98] sm:flex"><Plus className="h-3.5 w-3.5" />New run</button><button onClick={() => navigate("settings")} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-gradient-to-br from-violet-400 to-fuchsia-500 text-[11px] font-bold text-white">{initials(user?.name)}</button></div></header>
        <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-10">{authLoading ? <div className="grid min-h-[70vh] place-items-center"><div className="flex items-center gap-3 text-sm text-slate-400"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />Loading workspace...</div></div> : <>{!isAuthenticated && <AuthPanel mode={authMode} setMode={setAuthMode} name={authName} setName={setAuthName} email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword} pending={authMutation.isPending || signupMutation.isPending} onSubmit={() => authMode === "login" ? authMutation.mutate({ email: authEmail, password: authPassword }) : signupMutation.mutate({ name: authName, email: authEmail, password: authPassword })} />}{view}</>}</div>
      </main>
    </div>
    {workflowOpen && <WorkflowOverlay prompt={workflowPrompt} stage={stage} pending={workflow.isPending} result={workflow.data?.plan?.summary} onClose={() => !workflow.isPending && setWorkflowOpen(false)} />}
  </div>;
}

function OverviewView({ firstName, prompt, setPrompt, submitPrompt, goals, tasks, events, activeGoal, completedTasks, onToggle, onNavigate }: { firstName: string; prompt: string; setPrompt: (value: string) => void; submitPrompt: (value?: string) => void; goals: DemoGoal[]; tasks: DemoTask[]; events: DemoEvent[]; activeGoal?: DemoGoal; completedTasks: number; onToggle: (id: number) => void; onNavigate: (page: PageKey) => void }) {
  return <div className="space-y-8"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-end"><div><div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-lime-300 shadow-[0_0_12px_rgba(190,242,100,0.75)]" /><span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-lime-300/80">System online</span><span className="text-[10px] text-slate-600">/</span><span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Tuesday, September 15</span></div><h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Good morning, {firstName}<span className="text-cyan-300">.</span><br /><span className="text-slate-400">What will you move forward today?</span></h1></div><div className="flex items-center gap-2 text-xs text-slate-500"><span className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.03]"><Zap className="h-3.5 w-3.5 text-amber-200" /></span><span><strong className="font-semibold text-slate-300">4</strong> agents ready</span></div></div>
    <div className="relative overflow-hidden rounded-2xl border border-cyan-300/20 bg-[linear-gradient(115deg,rgba(15,35,50,0.86),rgba(11,18,30,0.96))] p-5 shadow-[0_18px_80px_rgba(34,211,238,0.06)] sm:p-6"><div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full border border-cyan-300/10" /><div className="pointer-events-none absolute -right-8 -top-12 h-40 w-40 rounded-full border border-cyan-300/10" /><div className="mb-4 flex items-center gap-2 text-xs font-medium text-cyan-200"><Sparkles className="h-4 w-4 text-cyan-300" />Orchestrate a goal</div><textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitPrompt(); } }} placeholder="Ask your AI OS to plan, research, organize, or analyze..." className="min-h-[72px] w-full resize-none bg-transparent pr-20 text-lg leading-relaxed text-white outline-none placeholder:text-slate-600" /><div className="flex flex-col justify-between gap-4 border-t border-white/[0.08] pt-4 sm:flex-row sm:items-center"><div className="flex flex-wrap gap-2"><button onClick={() => setPrompt("Help me prepare for an AI Engineer interview") } className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-200">Prepare for an interview</button><button onClick={() => setPrompt("Plan my week around the highest impact work") } className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-200">Plan my week</button><button onClick={() => setPrompt("Analyze my files and surface the most important next steps") } className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-300/30 hover:text-cyan-200">Analyze my files</button></div><button onClick={() => submitPrompt()} disabled={!prompt.trim()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]">Run workflow<ArrowUpRight className="h-4 w-4" /></button></div></div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]"><div className="space-y-5"><div className="flex items-end justify-between"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Focus map</p><h2 className="text-xl font-semibold tracking-tight text-white">Active goals</h2></div><button onClick={() => onNavigate("goals")} className="text-xs font-medium text-cyan-300 hover:text-cyan-200">View all <ChevronRight className="inline h-3.5 w-3.5" /></button></div><div className="grid gap-3">{goals.slice(0, 3).map((goal, index) => <div key={goal.id} className="group rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4 transition hover:border-white/[0.16] hover:bg-white/[0.04]"><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${index === 0 ? "bg-cyan-300/10 text-cyan-300" : index === 1 ? "bg-violet-300/10 text-violet-300" : "bg-amber-300/10 text-amber-200"}`}><Target className="h-4 w-4" /></span><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-100">{goal.title}</h3><p className="mt-1 line-clamp-1 text-xs text-slate-500">{goal.description}</p></div></div><Pill tone={goal.priority === "high" ? "pink" : "slate"}>{goal.priority}</Pill></div><div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]"><div className={`h-full rounded-full ${index === 0 ? "bg-cyan-300" : index === 1 ? "bg-violet-300" : "bg-amber-200"}`} style={{ width: `${goal.progress}%` }} /></div><span className="w-8 text-right text-[11px] font-semibold text-slate-300">{goal.progress}%</span></div><div className="mt-3 flex items-center justify-between text-[10px] text-slate-600"><span className="flex items-center gap-1"><ListChecks className="h-3 w-3" />{index === 0 ? "4 of 6 tasks" : index === 1 ? "2 of 5 tasks" : "1 of 4 tasks"}</span><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />This week</span></div></div>)}</div></div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="mb-5 flex items-start justify-between"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Live signal</p><h2 className="text-xl font-semibold tracking-tight text-white">AI activity</h2></div><span className="flex items-center gap-1.5 text-[10px] text-lime-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-300" />LIVE</span></div><div className="space-y-5">{events.slice(0, 4).map((event, index) => <div className="relative flex gap-3" key={event.id}>{index < Math.min(events.length, 4) - 1 && <span className="absolute left-[7px] top-5 h-10 w-px bg-white/[0.08]" />}<span className={`relative z-10 mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${event.eventType === "verified" ? "border-lime-300/40 bg-lime-300/10 text-lime-300" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-300"}`}>{event.eventType === "verified" ? <Check className="h-2.5 w-2.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span><div className="min-w-0"><div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-slate-200">{event.title}</p><span className="shrink-0 text-[10px] text-slate-600">{formatRelative(event.createdAt)}</span></div><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{event.description}</p></div></div>)}</div><button onClick={() => onNavigate("activity")} className="mt-6 flex w-full items-center justify-center gap-2 border-t border-white/[0.07] pt-4 text-[11px] font-medium text-slate-400 hover:text-white">Open execution timeline<ArrowUpRight className="h-3.5 w-3.5" /></button></div></div>
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="mb-5 flex items-center justify-between"><div><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Today</p><h2 className="text-xl font-semibold tracking-tight text-white">Next actions</h2></div><div className="flex items-center gap-3 text-xs text-slate-500"><span><strong className="text-slate-200">{completedTasks}</strong> completed</span><button onClick={() => onNavigate("tasks")} className="text-cyan-300 hover:text-cyan-200">Manage tasks <ChevronRight className="inline h-3.5 w-3.5" /></button></div></div><div className="grid gap-2 md:grid-cols-2">{tasks.map(task => <TaskRow key={task.id} task={task} onToggle={onToggle} />)}</div></div>
  </div>;
}

function TaskRow({ task, onToggle }: { task: DemoTask; onToggle: (id: number) => void }) { return <div className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-white/[0.08] hover:bg-white/[0.025]"><button onClick={() => onToggle(task.id)} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition ${task.status === "completed" ? "border-lime-300 bg-lime-300 text-slate-950" : task.status === "in_progress" ? "border-cyan-300 bg-cyan-300/10 text-cyan-300" : "border-slate-600 text-transparent hover:border-cyan-300"}`}>{task.status === "completed" ? <Check className="h-3 w-3" /> : task.status === "in_progress" ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Circle className="h-2.5 w-2.5" />}</button><div className="min-w-0 flex-1"><p className={`truncate text-sm ${task.status === "completed" ? "text-slate-500 line-through" : "text-slate-200"}`}>{task.title}</p><div className="mt-1 flex items-center gap-2 text-[10px] text-slate-600"><span>{task.agent}</span><span>•</span><span className={task.priority === "high" ? "text-rose-300/80" : ""}>{task.priority} priority</span></div></div><button className="rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-slate-300"><MoreHorizontal className="h-4 w-4" /></button></div>; }

function GoalsView({ goals }: { goals: DemoGoal[] }) { return <div><SectionHeader eyebrow="Workspace / focus map" title="Goals" detail="Keep the system pointed at outcomes, not just activity." action={<button className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950"><Plus className="h-4 w-4" />Create goal</button>} /><div className="grid gap-4 lg:grid-cols-2">{goals.map(goal => <div key={goal.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><Target className="h-5 w-5" /></div><div><h3 className="font-semibold text-white">{goal.title}</h3><p className="mt-1 text-xs text-slate-500">{goal.description}</p></div></div><Pill tone={goal.priority === "high" ? "pink" : "slate"}>{goal.priority}</Pill></div><div className="mt-6 flex items-center gap-4"><div className="h-2 flex-1 rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${goal.progress}%` }} /></div><span className="text-sm font-semibold text-white">{goal.progress}%</span></div><div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-4 text-[11px] text-slate-500"><span className="flex items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5" />Connected tasks</span><button className="text-cyan-300 hover:text-cyan-200">Open details <ChevronRight className="inline h-3.5 w-3.5" /></button></div></div>)}</div></div>; }
function TasksView({ tasks, onToggle }: { tasks: DemoTask[]; onToggle: (id: number) => void }) { return <div><SectionHeader eyebrow="Workspace / execution" title="Tasks" detail="The smallest useful next actions for each active goal." action={<div className="flex items-center gap-2"><button className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-slate-300">All tasks</button><button className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950"><Plus className="h-4 w-4" />New task</button></div>} /><div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]"><div className="hidden grid-cols-[1fr_130px_110px_130px] gap-4 border-b border-white/[0.07] px-5 py-3 text-[10px] uppercase tracking-[0.18em] text-slate-600 md:grid"><span>Task</span><span>Status</span><span>Priority</span><span>Assigned agent</span></div>{tasks.map(task => <div key={task.id} className="grid gap-3 border-b border-white/[0.06] px-5 py-4 last:border-b-0 md:grid-cols-[1fr_130px_110px_130px] md:items-center md:gap-4"><div className="flex items-start gap-3"><button onClick={() => onToggle(task.id)} className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${task.status === "completed" ? "border-lime-300 bg-lime-300 text-slate-950" : "border-slate-600 text-transparent hover:border-cyan-300"}`}>{task.status === "completed" && <Check className="h-3 w-3" />}</button><div><p className={`text-sm font-medium ${task.status === "completed" ? "text-slate-500 line-through" : "text-slate-200"}`}>{task.title}</p><p className="mt-1 text-xs text-slate-600">{task.description}</p></div></div><div><Pill tone={task.status === "completed" ? "lime" : task.status === "in_progress" ? "blue" : "slate"}>{task.status.replace("_", " ")}</Pill></div><div className="text-xs capitalize text-slate-400">{task.priority}</div><div className="flex items-center gap-2 text-xs text-slate-400"><Bot className="h-3.5 w-3.5 text-cyan-300" />{task.agent}</div></div>)}</div></div>; }
function MemoryView() { const memories = [{ category: "Preference", content: "Prefers concise, professional communication.", importance: 82 }, { category: "Work style", content: "Does deep work best before 11:00 and prefers a visible next action.", importance: 74 }, { category: "Learned information", content: "Building toward AI Engineer roles with an interest in agent evaluation.", importance: 91 }]; return <div><SectionHeader eyebrow="Context / long-term memory" title="Memory" detail="Your AI OS remembers selectively, and you stay in control." action={<button className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950"><Plus className="h-4 w-4" />Save memory</button>} /><div className="grid gap-4 lg:grid-cols-3">{memories.map(memory => <div key={memory.category} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><Pill tone="blue">{memory.category}</Pill><button className="text-slate-600 hover:text-white"><MoreHorizontal className="h-4 w-4" /></button></div><p className="mt-5 min-h-[60px] text-sm leading-relaxed text-slate-200">“{memory.content}”</p><div className="mt-6"><div className="mb-2 flex justify-between text-[10px] uppercase tracking-[0.15em] text-slate-600"><span>Importance</span><span className="text-cyan-300">{memory.importance}%</span></div><div className="h-1.5 rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-cyan-300" style={{ width: `${memory.importance}%` }} /></div></div><div className="mt-5 flex items-center gap-2 border-t border-white/[0.07] pt-4 text-[11px] text-slate-600"><Lock className="h-3 w-3" />Private to your workspace</div></div>)}</div></div>; }
function FilesView() { return <div><SectionHeader eyebrow="Context / retrieval" title="Files" detail="Give your agents grounded context from the documents you trust." action={<button className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950"><Plus className="h-4 w-4" />Upload file</button>} /><div className="rounded-2xl border border-dashed border-cyan-300/20 bg-cyan-300/[0.025] p-10 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-300"><Inbox className="h-6 w-6" /></div><h3 className="mt-4 font-semibold text-white">Drop files into your context layer</h3><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">PDF, DOCX, TXT, and CSV files are chunked and indexed for future retrieval. Your documents stay isolated to your account.</p><button className="mt-5 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-slate-200">Choose files</button></div><div className="mt-6 grid gap-3 md:grid-cols-3">{["CV.pdf", "Portfolio.pdf", "Project_Report.pdf"].map((file, index) => <div key={file} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-rose-300/10 text-rose-200"><FileText className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200">{file}</p><p className="mt-1 text-[10px] text-slate-600">{index === 0 ? "1.2 MB" : index === 1 ? "3.8 MB" : "860 KB"}</p></div></div><div className="mt-4 flex items-center gap-2 text-[10px] text-lime-300"><CheckCircle2 className="h-3.5 w-3.5" />Indexed and ready</div></div>)}</div></div>; }
function AgentsView() { const agents = [{ name: "Planner Agent", color: "cyan", purpose: "Turns high-level intent into an executable plan.", runs: "24 runs", rate: "96%" }, { name: "Research Agent", color: "violet", purpose: "Finds, compares, and cites useful information.", runs: "18 runs", rate: "92%" }, { name: "Critic Agent", color: "lime", purpose: "Checks outputs for completeness and quality.", runs: "31 runs", rate: "98%" }, { name: "Memory Agent", color: "amber", purpose: "Selectively stores useful long-term context.", runs: "12 runs", rate: "100%" }]; return <div><SectionHeader eyebrow="System / orchestration" title="Agents" detail="Specialists with clear responsibilities, scoped tools, and visible runs." /><div className="grid gap-4 md:grid-cols-2">{agents.map(agent => <div key={agent.name} className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className={`grid h-10 w-10 place-items-center rounded-xl ${agent.color === "cyan" ? "bg-cyan-300/10 text-cyan-300" : agent.color === "violet" ? "bg-violet-300/10 text-violet-300" : agent.color === "lime" ? "bg-lime-300/10 text-lime-300" : "bg-amber-300/10 text-amber-200"}`}><Bot className="h-5 w-5" /></div><div><h3 className="font-semibold text-white">{agent.name}</h3><div className="mt-1 flex items-center gap-1.5 text-[10px] text-lime-300"><span className="h-1.5 w-1.5 rounded-full bg-lime-300" />Active</div></div></div><button className="text-slate-600 hover:text-white"><MoreHorizontal className="h-4 w-4" /></button></div><p className="mt-5 text-sm leading-relaxed text-slate-400">{agent.purpose}</p><div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/[0.07] pt-4"><div><p className="text-[10px] uppercase tracking-[0.15em] text-slate-600">Recent runs</p><p className="mt-1 text-sm font-semibold text-slate-200">{agent.runs}</p></div><div><p className="text-[10px] uppercase tracking-[0.15em] text-slate-600">Success rate</p><p className="mt-1 text-sm font-semibold text-lime-300">{agent.rate}</p></div></div></div>)}</div></div>; }
function ActivityView({ events }: { events: DemoEvent[] }) { return <div><SectionHeader eyebrow="System / observability" title="Activity timeline" detail="A safe, human-readable trace of what your workspace is doing." action={<Pill tone="lime"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-lime-300" />Live stream</Pill>} /><div className="max-w-3xl rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 sm:p-7"><p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">Today / {formatToday()}</p><div className="space-y-7">{events.length === 0 ? <div className="py-12 text-center text-sm text-slate-500">No activity yet. Run a workflow or complete a task to see it here.</div> : events.slice(0, 6).map((event, index) => <div key={`${event.id}-${index}`} className="relative flex gap-4">{index < Math.min(events.length, 6) - 1 && <span className="absolute left-[8px] top-6 h-10 w-px bg-white/[0.08]" />}<span className={`relative z-10 mt-0.5 grid h-[17px] w-[17px] place-items-center rounded-full border ${event.eventType === "verified" ? "border-lime-300/40 bg-lime-300/10 text-lime-300" : "border-cyan-300/30 bg-cyan-300/10 text-cyan-300"}`}>{event.eventType === "verified" ? <Check className="h-2.5 w-2.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}</span><div className="flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-slate-200">{event.title}</p><span className="text-[10px] text-slate-600">{formatRelative(event.createdAt)}</span></div><p className="mt-1 text-xs leading-relaxed text-slate-500">{event.description}</p><span className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-cyan-300/70"><Bot className="h-3 w-3" />{event.agent}</span></div></div>)}</div></div></div>; }
function ToolsView() { const tools = [{ name: "Web search", desc: "Find current, cited information", permission: "Low risk", icon: Search }, { name: "Memory search", desc: "Retrieve relevant personal context", permission: "Private", icon: BrainCircuit }, { name: "Task manager", desc: "Create and update workspace tasks", permission: "Low risk", icon: ListChecks }, { name: "File search", desc: "Ground responses in uploaded files", permission: "Private", icon: FileText }, { name: "Email drafting", desc: "Prepare communication without sending", permission: "Approval required", icon: WandSparkles }, { name: "Calculator", desc: "Perform transparent calculations", permission: "Low risk", icon: Gauge }]; return <div><SectionHeader eyebrow="System / tool registry" title="Tools" detail="Every capability has a scope, permission level, and audit trail." /><div className="grid gap-3 md:grid-cols-2">{tools.map(tool => { const Icon = tool.icon; return <div key={tool.name} className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-cyan-300"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-200">{tool.name}</h3><p className="mt-1 text-xs text-slate-500">{tool.desc}</p></div><div className="text-right"><span className="block text-[10px] text-lime-300">Enabled</span><span className="mt-1 block text-[10px] text-slate-600">{tool.permission}</span></div></div> })}</div></div>; }
function SettingsView({ user, onLogout }: { user: string; onLogout: () => void }) { return <div><SectionHeader eyebrow="System / workspace" title="Settings" detail="Control how your AI OS works with you." /><div className="max-w-2xl space-y-4"><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 text-sm font-bold text-white">{initials(user)}</div><div><p className="font-semibold text-white">{user}</p><p className="mt-1 text-xs text-slate-500">Private workspace identity</p></div><Pill tone="lime">Protected</Pill></div></div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-white">Human approval boundary</h3><p className="mt-1 text-xs leading-relaxed text-slate-500">Sensitive actions such as sending email always pause for review.</p></div><span className="rounded-full bg-lime-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-lime-300">On</span></div></div><button onClick={onLogout} className="rounded-xl border border-rose-300/20 bg-rose-300/[0.06] px-4 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-300/10">Sign out</button></div></div>; }
function WorkflowOverlay({ prompt, stage, pending, result, onClose }: { prompt: string; stage: number; pending: boolean; result?: string; onClose: () => void }) { return <div className="fixed inset-0 z-[70] grid place-items-center bg-[#03060b]/80 p-5 backdrop-blur-md"><div className="w-full max-w-lg overflow-hidden rounded-3xl border border-cyan-300/20 bg-[#0b131f] shadow-[0_30px_120px_rgba(0,0,0,0.55)]"><div className="flex items-start justify-between border-b border-white/[0.08] p-6"><div><div className="mb-3 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-300/10 text-cyan-300"><WandSparkles className="h-4 w-4" /></span><span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Safe execution view</span></div><h2 className="text-xl font-semibold text-white">{pending ? "AI is working..." : "Workflow complete"}</h2><p className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">{prompt || "Your new goal"}</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button></div><div className="space-y-3 p-6">{stageLabels.map((label, index) => <div key={label} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${index < stage || (!pending && index === stage) ? "border-lime-300/20 bg-lime-300/[0.05]" : index === stage && pending ? "border-cyan-300/20 bg-cyan-300/[0.05]" : "border-white/[0.06] bg-white/[0.02]"}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${index < stage || (!pending && index === stage) ? "bg-lime-300 text-slate-950" : index === stage && pending ? "bg-cyan-300/15 text-cyan-300" : "bg-white/[0.06] text-slate-600"}`}>{index < stage || (!pending && index === stage) ? <Check className="h-3.5 w-3.5" /> : index === stage && pending ? <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" /> : <span className="text-[10px] font-semibold">{index + 1}</span>}</span><span className={`text-sm ${index <= stage ? "text-slate-200" : "text-slate-600"}`}>{label}</span>{index === stage && pending && <span className="ml-auto text-[10px] uppercase tracking-[0.16em] text-cyan-300">In progress</span>}</div>)}{result && <div className="mt-5 rounded-2xl border border-lime-300/20 bg-lime-300/[0.05] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-lime-300"><CheckCircle2 className="h-4 w-4" />Critic approved this plan</div><p className="mt-2 text-xs leading-relaxed text-slate-300">{result}</p></div>}</div><div className="flex items-center justify-between border-t border-white/[0.08] px-6 py-4"><span className="flex items-center gap-2 text-[10px] text-slate-600"><Lock className="h-3 w-3" />No hidden chain-of-thought shown</span><button disabled={pending} onClick={onClose} className="rounded-xl bg-white/[0.08] px-4 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40">{pending ? "Working" : "Close"}</button></div></div></div>; }

function ChatView({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [draft, setDraft] = useState("");
  const history = trpc.chat.history.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const send = trpc.chat.send.useMutation({ onSuccess: () => { setDraft(""); history.refetch(); } });
  const items = history.data?.messages ?? [];
  return <div className="mx-auto max-w-4xl space-y-6"><SectionHeader eyebrow="Communication Agent" title="Private AI chat" detail="Continue work across goals, tasks, memory, and approved workflows." /><div className="min-h-[440px] rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="space-y-4">{!isAuthenticated ? <div className="grid min-h-[320px] place-items-center text-center"><div><Lock className="mx-auto h-8 w-8 text-cyan-300/70" /><p className="mt-4 text-sm font-semibold text-slate-200">Sign in to use private chat</p><p className="mt-2 text-xs text-slate-500">Your conversations are stored in your private workspace.</p></div></div> : history.isLoading ? <div className="grid min-h-[320px] place-items-center text-sm text-slate-500">Loading conversation…</div> : history.isError ? <div className="grid min-h-[320px] place-items-center text-center"><div><p className="text-sm font-semibold text-rose-200">Chat is temporarily unavailable</p><p className="mt-2 text-xs text-slate-500">Try again after checking the server configuration.</p></div></div> : items.length === 0 ? <div className="grid min-h-[320px] place-items-center text-center"><div><MessageCircle className="mx-auto h-8 w-8 text-cyan-300/70" /><p className="mt-4 text-sm font-semibold text-slate-200">Start a private conversation</p><p className="mt-2 text-xs text-slate-500">Ask a question or tell your AI OS what to move forward.</p></div></div> : items.map(message => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-cyan-300 text-slate-950" : "border border-white/[0.08] bg-white/[0.04] text-slate-200"}`}>{message.content}</div></div>)}</div></div><form onSubmit={event => { event.preventDefault(); if (isAuthenticated && draft.trim() && !send.isPending) send.mutate({ conversationId: history.data?.conversation?.id, content: draft.trim() }); }} className="flex gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.04] p-3"><input disabled={!isAuthenticated} value={draft} onChange={event => setDraft(event.target.value)} placeholder={isAuthenticated ? "Ask your AI OS anything..." : "Sign in to start chatting"} className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed" /><button disabled={!isAuthenticated || !draft.trim() || send.isPending} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40"><ArrowUpRight className="h-4 w-4" />{send.isPending ? "Thinking" : "Send"}</button></form></div>;
}

function AuthPanel({ mode, setMode, name, setName, email, setEmail, password, setPassword, pending, onSubmit }: { mode: "login" | "signup"; setMode: (mode: "login" | "signup") => void; name: string; setName: (value: string) => void; email: string; setEmail: (value: string) => void; password: string; setPassword: (value: string) => void; pending: boolean; onSubmit: () => void }) {
  return <div className="mb-8 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.05] p-5"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Private workspace</p><h2 className="mt-2 text-xl font-semibold text-white">{mode === "login" ? "Sign in to persist your work" : "Create your private AI OS"}</h2><p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">Goals, tasks, conversations, memories, and activity are isolated to your account.</p></div><div className="flex rounded-xl border border-white/10 bg-black/10 p-1 text-xs"><button onClick={() => setMode("login")} className={`rounded-lg px-3 py-2 ${mode === "login" ? "bg-white/10 text-white" : "text-slate-500"}`}>Sign in</button><button onClick={() => setMode("signup")} className={`rounded-lg px-3 py-2 ${mode === "signup" ? "bg-white/10 text-white" : "text-slate-500"}`}>Create account</button></div></div><form onSubmit={event => { event.preventDefault(); onSubmit(); }} className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">{mode === "signup" && <input value={name} onChange={event => setName(event.target.value)} placeholder="Name" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600" />}<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600" /><input required type="password" minLength={mode === "signup" ? 10 : 1} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === "signup" ? "Password (10+ characters)" : "Password"} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600" /><button disabled={pending} className="rounded-xl bg-cyan-300 px-5 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40">{pending ? "Working..." : mode === "login" ? "Sign in" : "Create account"}</button></form></div>;
}
