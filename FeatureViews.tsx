import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Streamdown } from "streamdown";

type FeatureProps = { onOpenPage?: (page: string) => void };
const panel = "rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5";
const input =
  "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-300/40";
const button =
  "rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950 disabled:opacity-40";
function SectionHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
        {eyebrow}
      </p>
      <h2 className="text-xl font-semibold tracking-tight text-white">
        {title}
      </h2>
      {detail && <p className="mt-1 text-sm text-slate-400">{detail}</p>}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-white/[0.08] p-5 text-sm text-slate-500">
      {text}
    </p>
  );
}
function Pill({
  children,
  tone = "slate",
}: {
  children: string;
  tone?: "lime" | "amber" | "slate";
}) {
  const c =
    tone === "lime"
      ? "border-lime-400/20 bg-lime-400/10 text-lime-300"
      : tone === "amber"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-200"
        : "border-white/10 bg-white/[0.06] text-slate-300";
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${c}`}
    >
      {children}
    </span>
  );
}

export function CalendarView() {
  const query = trpc.calendar.list.useQuery();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const create = trpc.calendar.create.useMutation({
    onSuccess: () => {
      query.refetch();
      setTitle("");
      setDescription("");
      setStartsAt("");
      setEndsAt("");
      toast.success("Event added to calendar");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.calendar.delete.useMutation({
    onSuccess: () => query.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const reminders = trpc.reminders.list.useQuery();
  const [rt, setRt] = useState("");
  const [rd, setRd] = useState("");
  const [rr, setRr] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const addReminder = trpc.reminders.create.useMutation({
    onSuccess: () => {
      reminders.refetch();
      setRt("");
      setRd("");
      toast.success("Reminder saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const complete = trpc.reminders.complete.useMutation({
    onSuccess: () => reminders.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const deleteReminder = trpc.reminders.delete.useMutation({
    onSuccess: () => reminders.refetch(),
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Planning / time"
        title="Calendar & reminders"
        detail="Events and recurring reminders are stored in your account."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <section className={panel}>
          <h3 className="mb-4 text-sm font-semibold">Add calendar event</h3>
          <div className="space-y-3">
            <input
              className={input}
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className={input}
              placeholder="Notes (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label className="block text-xs text-slate-400">
              Starts
              <input
                className={input + " mt-1"}
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="block text-xs text-slate-400">
              Ends (optional)
              <input
                className={input + " mt-1"}
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
            <button
              className={button}
              disabled={!title.trim() || !startsAt || create.isPending}
              onClick={() =>
                create.mutate({
                  title,
                  description,
                  startsAt: new Date(startsAt),
                  endsAt: endsAt ? new Date(endsAt) : null,
                })
              }
            >
              Save event
            </button>
          </div>
        </section>
        <section className={panel}>
          <h3 className="mb-4 text-sm font-semibold">Add reminder</h3>
          <div className="space-y-3">
            <input
              className={input}
              placeholder="What should you remember?"
              value={rt}
              onChange={(e) => setRt(e.target.value)}
            />
            <input
              className={input}
              type="datetime-local"
              value={rd}
              onChange={(e) => setRd(e.target.value)}
            />
            <select
              className={input}
              value={rr}
              onChange={(e) => setRr(e.target.value as typeof rr)}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            <button
              className={button}
              disabled={!rt.trim() || !rd || addReminder.isPending}
              onClick={() =>
                addReminder.mutate({
                  title: rt,
                  dueAt: new Date(rd),
                  recurrence: rr,
                })
              }
            >
              Save reminder
            </button>
          </div>
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className={panel}>
          <h3 className="mb-3 text-sm font-semibold">Upcoming events</h3>
          {!query.data?.length ? (
            <Empty text="No events scheduled yet." />
          ) : (
            <div className="space-y-2">
              {query.data.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{e.title}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(e.startsAt).toLocaleString()}
                      {e.endsAt
                        ? ` – ${new Date(e.endsAt).toLocaleTimeString()}`
                        : ""}
                    </p>
                    {e.description && (
                      <p className="mt-1 text-xs text-slate-400">
                        {e.description}
                      </p>
                    )}
                  </div>
                  <button
                    className="text-xs text-rose-300"
                    onClick={() => remove.mutate({ id: e.id })}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className={panel}>
          <h3 className="mb-3 text-sm font-semibold">Reminders</h3>
          {!reminders.data?.length ? (
            <Empty text="No reminders yet." />
          ) : (
            <div className="space-y-2">
              {reminders.data.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] p-3"
                >
                  <div>
                    <p
                      className={`text-sm ${r.completedAt ? "text-slate-500 line-through" : "text-slate-100"}`}
                    >
                      {r.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(r.dueAt).toLocaleString()} · {r.recurrence}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      className="text-xs text-cyan-300"
                      onClick={() => complete.mutate({ id: r.id })}
                    >
                      {r.completedAt ? "Done" : "Complete"}
                    </button>
                    <button
                      className="text-xs text-rose-300"
                      onClick={() => deleteReminder.mutate({ id: r.id })}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function DocumentsView() {
  const query = trpc.documents.list.useQuery();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const results = trpc.documents.search.useQuery(
    { query: term },
    { enabled: !!term },
  );
  const del = trpc.documents.delete.useMutation({
    onSuccess: () => query.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const upload = trpc.documents.upload.useMutation({
    onSuccess: () => {
      query.refetch();
      toast.success("Document indexed");
    },
    onError: (e) => toast.error(e.message),
  });
  async function handleFile(file?: File) {
    if (!file) return;
    const types = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!types.includes(file.type)) {
      toast.error("Choose a PDF, DOCX, or TXT file.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Files must be 6 MB or smaller.");
      return;
    }
    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
    upload.mutate({
      filename: file.name,
      mimeType: file.type as
        | "text/plain"
        | "application/pdf"
        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dataBase64,
    });
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Context / knowledge base"
        title="Documents"
        detail="Upload documents for extraction, summaries, and full-text search."
      />
      <section className={panel}>
        <label className="flex cursor-pointer flex-col items-center rounded-xl border border-dashed border-cyan-300/30 p-8 text-center">
          <span className="text-sm font-semibold">
            {upload.isPending
              ? "Extracting and indexing…"
              : "Select PDF, DOCX, or TXT"}
          </span>
          <span className="mt-1 text-xs text-slate-500">
            Maximum size: 6 MB
          </span>
          <input
            className="sr-only"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            disabled={upload.isPending}
            onChange={(e) => {
              void handleFile(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        <div className="mt-5 flex gap-2">
          <input
            className={input}
            placeholder="Search document contents…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setTerm(search.trim())}
          />
          <button className={button} onClick={() => setTerm(search.trim())}>
            Search
          </button>
        </div>
      </section>
      {term && (
        <section className={panel}>
          <h3 className="mb-3 text-sm font-semibold">Search matches</h3>
          {!results.data?.length ? (
            <Empty text="No matching document text found." />
          ) : (
            <div className="space-y-3">
              {results.data.map((d) => (
                <article
                  key={d.id}
                  className="rounded-xl border border-white/[0.07] p-3"
                >
                  <p className="text-sm font-semibold">{d.filename}</p>
                  <p className="mt-1 text-xs text-slate-400">{d.excerpt}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Your library</h3>
        {!query.data?.length ? (
          <Empty text="Uploaded files and summaries will appear here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {query.data.map((d) => (
              <article
                key={d.id}
                className="rounded-xl border border-white/[0.07] p-4"
              >
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{d.filename}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    className="text-xs text-rose-300"
                    onClick={() => del.mutate({ id: d.id })}
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  {d.summary}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function GlobalSearchView() {
  const [q, setQ] = useState("");
  const [run, setRun] = useState("");
  const results = trpc.search.global.useQuery(
    { query: run },
    { enabled: !!run },
  );
  const groups: [string, any[]][] = results.data
    ? [
        ["Chats", results.data.chats],
        ["Messages", results.data.messages],
        ["Memories", results.data.memories],
        ["Goals", results.data.goals],
        ["Tasks", results.data.tasks],
        ["Documents", results.data.documents],
      ]
    : [];
  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Workspace / find anything"
        title="Global search"
        detail="Search your conversations, messages, memories, goals, tasks, and documents."
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRun(q.trim());
        }}
      >
        <input
          className={input}
          autoFocus
          placeholder="Search your workspace…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={button} disabled={!q.trim()}>
          Search
        </button>
      </form>
      {run &&
        groups.map(([label, items]) => (
          <section key={label} className={panel}>
            <h3 className="mb-3 text-sm font-semibold">
              {label} <span className="text-slate-500">{items.length}</span>
            </h3>
            {items.length ? (
              items.map((it: any) => (
                <div
                  key={it.id}
                  className="border-t border-white/[0.06] py-2 text-sm text-slate-300"
                >
                  {it.title ||
                    it.content ||
                    it.filename ||
                    it.summary ||
                    "Conversation"}
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">No matches</p>
            )}
          </section>
        ))}
    </div>
  );
}

export function EmailAssistantView() {
  const [prompt, setPrompt] = useState("");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const history = trpc.email.history.useQuery();
  const draft = trpc.email.draft.useMutation({
    onSuccess: (r) => {
      setRecipient((r as any).recipient || "");
      setSubject((r as any).subject || "");
      setBody((r as any).body || "");
      toast.success("Draft ready to review");
    },
    onError: (e) => toast.error(e.message),
  });
  const send = trpc.email.send.useMutation({
    onSuccess: () => {
      history.refetch();
      setBody("");
      toast.success("Email delivered by Resend");
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Communication / email"
        title="Email assistant"
        detail="Draft with AI, review every field, then explicitly send through Resend."
      />
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Draft with AI</h3>
        <textarea
          className={input + " min-h-24"}
          placeholder="Describe the email you want to write…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button
          className={button + " mt-3"}
          disabled={!prompt.trim() || draft.isPending}
          onClick={() => draft.mutate({ prompt })}
        >
          {draft.isPending ? "Drafting…" : "Generate draft"}
        </button>
      </section>
      <section className={panel}>
        <h3 className="mb-4 text-sm font-semibold">Review and send</h3>
        <div className="space-y-3">
          <label className="block text-xs text-slate-400">
            To
            <input
              className={input + " mt-1"}
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="recipient@example.com"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Subject
            <input
              className={input + " mt-1"}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Message
            <textarea
              className={input + " mt-1 min-h-48"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={
              !recipient || !subject.trim() || !body.trim() || send.isPending
            }
            onClick={() => send.mutate({ recipient, subject, body })}
          >
            {send.isPending ? "Sending…" : "Send email"}
          </button>
        </div>
      </section>
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Sent email history</h3>
        {!history.data?.length ? (
          <Empty text="No sent email records yet." />
        ) : (
          <div className="space-y-2">
            {history.data.map((m) => (
              <div
                key={m.id}
                className="flex justify-between gap-3 rounded-xl border border-white/[0.07] p-3"
              >
                <div>
                  <p className="text-sm font-medium">{m.subject}</p>
                  <p className="text-xs text-slate-500">
                    To {m.recipient} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
                <Pill tone={m.status === "sent" ? "lime" : "amber"}>
                  {m.status}
                </Pill>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function InsightsView() {
  const data = trpc.productivity.insights.useQuery();
  const summary = trpc.productivity.weeklySummary.useMutation({
    onSuccess: () => recent.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const recent = trpc.productivity.recentSummaries.useQuery();
  const reminders = trpc.reminders.list.useQuery();
  const dashboard = trpc.dashboard.get.useQuery();
  const suggestions = trpc.productivity.smartSuggestions.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const addTask = trpc.productivity.generateGoalTasks.useMutation({
    onSuccess: (r) => {
      dashboard.refetch();
      toast.success(`${r.created} AI-suggested tasks added`);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Signals / personal analytics"
        title="Productivity insights"
        detail="Progress, deadlines, overdue actions, and inactivity signals from your saved workspace."
      />
      <section className={panel}>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Tasks" value={data.data?.counts.tasks ?? 0} />
          <Metric label="Completed" value={data.data?.counts.completed ?? 0} />
          <Metric
            label="Active goals"
            value={data.data?.counts.activeGoals ?? 0}
          />
        </div>
      </section>
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Goal progress</h3>
        {!dashboard.data?.goals.length ? (
          <Empty text="Create goals to see analytics." />
        ) : (
          <div className="space-y-4">
            {dashboard.data.goals.map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>{g.title}</span>
                  <span className="text-cyan-300">{g.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-300"
                    style={{ width: `${g.progress}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                  <span>{g.status}</span>
                  <span>
                    {g.deadline
                      ? `Due ${new Date(g.deadline).toLocaleDateString()}:`
                      : "No deadline"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={panel}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Needs attention</h3>
            <button
              className="text-xs text-cyan-300"
              disabled={suggestions.isPending}
              onClick={() => suggestions.mutate()}
            >
              {suggestions.isPending ? "Thinking…" : "Get AI suggestions"}
            </button>
          </div>
          {suggestions.data?.suggestions && (
            <div className="markdown-content mb-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-3 text-xs text-slate-200">
              <Streamdown mode="static">
                {suggestions.data.suggestions}
              </Streamdown>
            </div>
          )}
          {!data.data?.overdue.length && !data.data?.inactive.length ? (
            <Empty text="No overdue tasks or inactive goals detected." />
          ) : (
            <div className="space-y-3">
              {data.data?.overdue.map((t) => (
                <div
                  key={`t${t.id}`}
                  className="rounded-xl border border-amber-300/20 p-3"
                >
                  <p className="text-sm">Overdue task: {t.title}</p>
                  <p className="text-xs text-slate-500">
                    Due{" "}
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : ""}
                  </p>
                </div>
              ))}
              {data.data?.inactive.map((g) => (
                <div
                  key={`g${g.id}`}
                  className="rounded-xl border border-violet-300/20 p-3"
                >
                  <p className="text-sm">Goal may need attention: {g.title}</p>
                  <p className="text-xs text-slate-500">
                    {g.progress}% complete · no update in 14+ days
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className={panel}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Weekly AI summary</h3>
            <button
              className={button}
              onClick={() => summary.mutate()}
              disabled={summary.isPending}
            >
              {summary.isPending ? "Writing…" : "Generate summary"}
            </button>
          </div>
          {summary.data?.summary ? (
            <div className="markdown-content mt-4 text-sm leading-6 text-slate-300">
              <Streamdown mode="static">{summary.data.summary}</Streamdown>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Generate a private summary of this week’s progress and next steps.
            </p>
          )}
          {recent.data?.map((r) => (
            <details
              key={r.id}
              className="mt-4 border-t border-white/[0.06] pt-3"
            >
              <summary className="cursor-pointer text-xs text-slate-400">
                Saved summary · week of{" "}
                {new Date(r.weekOf).toLocaleDateString()}
              </summary>
              <div className="markdown-content mt-3 text-sm text-slate-300">
                <Streamdown mode="static">{r.summary}</Streamdown>
              </div>
            </details>
          ))}
        </section>
      </div>
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Suggested goal actions</h3>
        {!dashboard.data?.goals.length ? (
          <Empty text="Add a goal first to get tailored next-action suggestions." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {dashboard.data.goals
              .filter((g) => g.status === "active")
              .map((g) => (
                <div
                  key={g.id}
                  className="rounded-xl border border-white/[0.07] p-3"
                >
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="my-2 text-xs text-slate-500">
                    Ask the AI to generate concrete next actions based on this
                    goal.
                  </p>
                  <button
                    className="text-xs text-cyan-300"
                    onClick={() => addTask.mutate({ goalId: g.id })}
                  >
                    Generate AI tasks
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/[0.06] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

export function PrivacySettingsView({ onLogout }: { onLogout: () => void }) {
  const utils = trpc.useUtils();
  const sessions = trpc.privacy.sessions.useQuery();
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("Password updated");
      setOld("");
      setNew("");
    },
    onError: (e) => toast.error(e.message),
  });
  const clear = trpc.privacy.clearHistory.useMutation({
    onSuccess: () => {
      toast.success("History cleared");
      void utils.history.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.privacy.revokeSession.useMutation({
    onSuccess: () => sessions.refetch(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.privacy.deleteAccount.useMutation({
    onSuccess: () => onLogout(),
    onError: (e) => toast.error(e.message),
  });
  const [old, setOld] = useState("");
  const [next, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  async function exportData() {
    try {
      const data = await utils.privacy.export.fetch();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "personal-ai-os-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  }
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Account / privacy"
        title="Privacy & sessions"
        detail="Manage your password, export your data, and control account sessions."
      />
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Change password</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <input
            className={input}
            type="password"
            placeholder="Current password (if set)"
            value={old}
            onChange={(e) => setOld(e.target.value)}
          />
          <input
            className={input}
            type="password"
            minLength={10}
            placeholder="New password (10+ chars)"
            value={next}
            onChange={(e) => setNew(e.target.value)}
          />
          <button
            className={button}
            disabled={next.length < 10 || change.isPending}
            onClick={() =>
              change.mutate({
                currentPassword: old || undefined,
                newPassword: next,
              })
            }
          >
            Update password
          </button>
        </div>
      </section>
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Data controls</h3>
        <div className="flex flex-wrap gap-3">
          <button className={button} onClick={() => void exportData()}>
            Export my data (JSON)
          </button>
          <button
            className="rounded-xl border border-amber-300/30 px-4 py-2.5 text-xs text-amber-200"
            onClick={() => {
              if (
                window.confirm(
                  "Clear chats and activity history? Memories, goals, tasks, and documents remain.",
                )
              )
                clear.mutate();
            }}
          >
            Clear chat and activity history
          </button>
        </div>
      </section>
      <section className={panel}>
        <h3 className="mb-3 text-sm font-semibold">Active sessions</h3>
        {sessions.data?.map((s, i) => (
          <div
            key={s.id}
            className="flex items-center justify-between border-t border-white/[0.06] py-3 text-xs"
          >
            <span>
              Session {i + 1} · created {new Date(s.createdAt).toLocaleString()}{" "}
              · expires {new Date(s.expiresAt).toLocaleDateString()}
            </span>
            <button
              className="text-rose-300"
              onClick={() => revoke.mutate({ id: s.id })}
            >
              Revoke
            </button>
          </div>
        ))}
      </section>
      <section className="rounded-2xl border border-rose-300/20 bg-rose-300/[0.03] p-5">
        <h3 className="text-sm font-semibold text-rose-200">Delete account</h3>
        <p className="mt-1 text-xs text-slate-400">
          Permanently removes your profile and associated workspace data. This
          cannot be undone.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className={input}
            type="password"
            placeholder="Confirm with account password (Google-only accounts may leave blank)"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            className="rounded-xl bg-rose-400 px-4 py-2.5 text-xs font-bold text-slate-950"
            onClick={() => {
              if (
                window.confirm(
                  "Permanently delete your account and all associated data?",
                )
              )
                remove.mutate({ password: confirm || undefined });
            }}
          >
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}

export function DashboardSignals() {
  const info = trpc.productivity.insights.useQuery();
  const reminders = trpc.reminders.list.useQuery();
  const upcoming = (reminders.data || [])
    .filter((r) => !r.completedAt && new Date(r.dueAt) >= new Date())
    .slice(0, 3);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Open tasks
        </p>
        <p className="mt-2 text-xl font-semibold">
          {Math.max(
            0,
            (info.data?.counts.tasks || 0) - (info.data?.counts.completed || 0),
          )}
        </p>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Active goals
        </p>
        <p className="mt-2 text-xl font-semibold">
          {info.data?.counts.activeGoals || 0}
        </p>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Upcoming reminders
        </p>
        {upcoming.length ? (
          upcoming.map((r) => (
            <p key={r.id} className="mt-1 truncate text-xs text-slate-300">
              {r.title} · {new Date(r.dueAt).toLocaleDateString()}
            </p>
          ))
        ) : (
          <p className="mt-2 text-xs text-slate-500">None scheduled</p>
        )}
      </div>
    </div>
  );
}
