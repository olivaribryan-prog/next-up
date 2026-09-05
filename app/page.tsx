"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase, Participant, DateIdea, Vote } from "@/lib/supabaseClient";

const SESSION_KEY = "next-up-participant";

type CostType = "free" | "budget";

function loadSession(): Participant | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(p: Participant) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(p));
}

function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export default function Home() {
  const [me, setMe] = useState<Participant | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMe(loadSession());
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!me) return <JoinGate onJoined={setMe} />;

  return <App me={me} onLeave={() => { clearSession(); setMe(null); }} />;
}

function JoinGate({ onJoined }: { onJoined: (p: Participant) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email.");
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();

    const { data: existing, error: findErr } = await supabase
      .from("participants")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (findErr) {
      setError(findErr.message);
      setBusy(false);
      return;
    }

    if (existing) {
      saveSession(existing as Participant);
      onJoined(existing as Participant);
      return;
    }

    const { data: created, error: insertErr } = await supabase
      .from("participants")
      .insert({ name: name.trim(), email: cleanEmail })
      .select()
      .single();

    setBusy(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    saveSession(created as Participant);
    onJoined(created as Participant);
  }

  return (
    <div className="join-wrap">
      <div className="join-card">
        <h1>Next Up</h1>
        <p>Suggest date ideas, vote on your favorites, and keep track of what&rsquo;s coming up. Just tell us who you are.</p>
        <form onSubmit={handleSubmit}>
          <div>
            <label className="field-label" htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <label className="field-label" htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {error && <span className="error-text">{error}</span>}
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "One sec…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function App({ me, onLeave }: { me: Participant; onLeave: () => void }) {
  const [tab, setTab] = useState<"poll" | "calendar">("poll");
  const [ideas, setIdeas] = useState<DateIdea[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [ideasRes, votesRes, peopleRes] = await Promise.all([
      supabase.from("date_ideas").select("*").order("created_at", { ascending: false }),
      supabase.from("votes").select("*"),
      supabase.from("participants").select("*"),
    ]);
    if (ideasRes.data) setIdeas(ideasRes.data as DateIdea[]);
    if (votesRes.data) setVotes(votesRes.data as Vote[]);
    if (peopleRes.data) {
      const map: Record<string, Participant> = {};
      (peopleRes.data as Participant[]).forEach((p) => (map[p.id] = p));
      setParticipants(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("next-up-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "date_ideas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const votesByIdea = useMemo(() => {
    const map: Record<string, Vote[]> = {};
    votes.forEach((v) => {
      map[v.date_idea_id] = map[v.date_idea_id] || [];
      map[v.date_idea_id].push(v);
    });
    return map;
  }, [votes]);

  async function toggleVote(idea: DateIdea) {
    const mine = votesByIdea[idea.id]?.find((v) => v.participant_id === me.id);
    if (mine) {
      await supabase.from("votes").delete().eq("id", mine.id);
    } else {
      await supabase.from("votes").insert({ date_idea_id: idea.id, participant_id: me.id });
    }
  }

  async function addIdea(input: {
    title: string;
    description: string;
    location: string;
    cost_type: CostType;
    budget_amount: string;
  }) {
    await supabase.from("date_ideas").insert({
      title: input.title.trim(),
      description: input.description.trim() || null,
      location: input.location.trim() || null,
      cost_type: input.cost_type,
      budget_amount: input.cost_type === "budget" && input.budget_amount ? Number(input.budget_amount) : null,
      created_by: me.id,
      status: "suggested",
    });
  }

  async function scheduleIdea(idea: DateIdea, date: string) {
    await supabase
      .from("date_ideas")
      .update({ proposed_date: date, status: "scheduled" })
      .eq("id", idea.id);
  }

  async function markPast(idea: DateIdea) {
    await supabase.from("date_ideas").update({ status: "past" }).eq("id", idea.id);
  }

  const pollIdeas = ideas
    .filter((i) => i.status === "suggested")
    .sort((a, b) => (votesByIdea[b.id]?.length || 0) - (votesByIdea[a.id]?.length || 0));

  const upcoming = ideas
    .filter((i) => i.status === "scheduled" && i.proposed_date)
    .sort((a, b) => (a.proposed_date! < b.proposed_date! ? -1 : 1));

  const past = ideas
    .filter((i) => i.status === "past")
    .sort((a, b) => (a.proposed_date && b.proposed_date ? (a.proposed_date < b.proposed_date ? 1 : -1) : 0));

  return (
    <div className="shell">
      <header className="header">
        <div className="wordmark">
          Next Up
          <span>Date ideas, polls, and what&rsquo;s coming up</span>
        </div>
        <div className="whoami">
          {me.name}
          <button onClick={onLeave}>Not you? Switch</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === "poll" ? "active" : ""}`} onClick={() => setTab("poll")}>
          Ideas &amp; poll
        </button>
        <button className={`tab ${tab === "calendar" ? "active" : ""}`} onClick={() => setTab("calendar")}>
          Calendar
        </button>
      </nav>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : tab === "poll" ? (
        <PollTab
          ideas={pollIdeas}
          votesByIdea={votesByIdea}
          participants={participants}
          me={me}
          onVote={toggleVote}
          onAdd={addIdea}
          onSchedule={scheduleIdea}
        />
      ) : (
        <CalendarTab upcoming={upcoming} past={past} participants={participants} onMarkPast={markPast} />
      )}
    </div>
  );
}

function PollTab({
  ideas,
  votesByIdea,
  participants,
  me,
  onVote,
  onAdd,
  onSchedule,
}: {
  ideas: DateIdea[];
  votesByIdea: Record<string, Vote[]>;
  participants: Record<string, Participant>;
  me: Participant;
  onVote: (idea: DateIdea) => void;
  onAdd: (input: { title: string; description: string; location: string; cost_type: CostType; budget_amount: string }) => Promise<void>;
  onSchedule: (idea: DateIdea, date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [costType, setCostType] = useState<CostType>("free");
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onAdd({ title, description, location, cost_type: costType, budget_amount: budget });
    setSubmitting(false);
    setTitle("");
    setDescription("");
    setLocation("");
    setCostType("free");
    setBudget("");
    setOpen(false);
  }

  return (
    <div>
      <div className="section-heading">
        <h2>Suggestions</h2>
        <button className="btn secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Suggest something"}
        </button>
      </div>

      {open && (
        <form className="form-grid card" onSubmit={handleSubmit} style={{ marginBottom: "1.75rem" }}>
          <input placeholder="What's the idea?" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <textarea placeholder="Any details worth sharing" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="form-row">
            <input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="cost-toggle">
              <button type="button" className={costType === "free" ? "active" : ""} onClick={() => setCostType("free")}>
                Free
              </button>
              <button type="button" className={costType === "budget" ? "active" : ""} onClick={() => setCostType("budget")}>
                Has a cost
              </button>
            </div>
            {costType === "budget" && (
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Approx. cost ($)"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            )}
          </div>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add to the poll"}
          </button>
        </form>
      )}

      {ideas.length === 0 ? (
        <p className="empty">No suggestions yet — add the first one.</p>
      ) : (
        <div className="idea-list">
          {ideas.map((idea) => {
            const ideaVotes = votesByIdea[idea.id] || [];
            const mine = ideaVotes.some((v) => v.participant_id === me.id);
            const suggester = idea.created_by ? participants[idea.created_by] : null;
            return (
              <div className="card idea-card" key={idea.id}>
                <div className="idea-main">
                  <h3>{idea.title}</h3>
                  {idea.description && <p className="idea-desc">{idea.description}</p>}
                  <div className="idea-meta">
                    <span className={`tag ${idea.cost_type}`}>
                      {idea.cost_type === "free" ? "Free" : idea.budget_amount ? `~$${idea.budget_amount}` : "Has a cost"}
                    </span>
                    {idea.location && <span className="idea-location">{idea.location}</span>}
                  </div>
                  {suggester && <div className="suggested-by">Suggested by {suggester.name}</div>}
                  <div className="schedule-row">
                    <input
                      type="date"
                      onChange={(e) => {
                        if (e.target.value) onSchedule(idea, e.target.value);
                      }}
                    />
                    <span className="idea-location">put it on the calendar</span>
                  </div>
                </div>
                <div className="vote-block">
                  <button className={`vote-btn ${mine ? "voted" : ""}`} onClick={() => onVote(idea)} aria-label="Vote for this idea">
                    {mine ? "✓" : "+"}
                  </button>
                  <span className="vote-count">{ideaVotes.length} vote{ideaVotes.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    day: d.getDate(),
    dow: d.toLocaleDateString(undefined, { weekday: "short" }),
    month: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

function CalendarTab({
  upcoming,
  past,
  participants,
  onMarkPast,
}: {
  upcoming: DateIdea[];
  past: DateIdea[];
  participants: Record<string, Participant>;
  onMarkPast: (idea: DateIdea) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<string, DateIdea[]> = {};
    upcoming.forEach((idea) => {
      const { month } = formatDay(idea.proposed_date!);
      map[month] = map[month] || [];
      map[month].push(idea);
    });
    return map;
  }, [upcoming]);

  return (
    <div>
      <div className="section-heading">
        <h2>Upcoming</h2>
      </div>
      {upcoming.length === 0 ? (
        <p className="empty">Nothing on the calendar yet — schedule an idea from the poll.</p>
      ) : (
        Object.entries(grouped).map(([month, items]) => (
          <div className="calendar-month" key={month}>
            <h3>{month}</h3>
            {items.map((idea) => {
              const { day, dow } = formatDay(idea.proposed_date!);
              const suggester = idea.created_by ? participants[idea.created_by] : null;
              return (
                <div className="calendar-item" key={idea.id}>
                  <div className="calendar-date">
                    <div className="day">{day}</div>
                    <div className="dow">{dow}</div>
                  </div>
                  <div className="idea-main" style={{ flex: 1 }}>
                    <h3>{idea.title}</h3>
                    {idea.description && <p className="idea-desc">{idea.description}</p>}
                    <div className="idea-meta">
                      <span className={`tag ${idea.cost_type}`}>
                        {idea.cost_type === "free" ? "Free" : idea.budget_amount ? `~$${idea.budget_amount}` : "Has a cost"}
                      </span>
                      {idea.location && <span className="idea-location">{idea.location}</span>}
                    </div>
                    {suggester && <div className="suggested-by">Suggested by {suggester.name}</div>}
                  </div>
                  <button className="btn secondary" onClick={() => onMarkPast(idea)}>
                    Mark done
                  </button>
                </div>
              );
            })}
          </div>
        ))
      )}

      {past.length > 0 && (
        <div className="calendar-month">
          <h3>Past</h3>
          {past.map((idea) => (
            <div className="calendar-item" key={idea.id}>
              <div className="idea-main" style={{ flex: 1 }}>
                <h3>{idea.title}</h3>
                {idea.proposed_date && <div className="idea-location">{formatDay(idea.proposed_date).month}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
