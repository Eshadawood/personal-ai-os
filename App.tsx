import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/_core/hooks/useAuth";
import NotFound from "@/pages/NotFound";
import { Redirect, Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import LoginPage from "./LoginPage";

function AuthGate() {
  const { user, loading } = useAuth();
  const [location] = useLocation();
  const publicRoute = location === "/login";

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#070b12] text-sm text-slate-400"><span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-cyan-300" />Checking your session…</div>;
  }
  if (!user && !publicRoute) return <Redirect to="/login" />;
  if (user && publicRoute) return <Redirect to="/app" />;

  return <Switch>
    <Route path="/login"><LoginPage initialMode="login" /></Route>
    <Route path="/signup"><Redirect to="/login" /></Route>
    <Route path="/"><Redirect to="/app" /></Route>
    <Route path="/app" component={Home} />
    <Route path="/app/overview" component={Home} />
    <Route path="/app/chat" component={Home} />
    <Route path="/app/goals" component={Home} />
    <Route path="/app/tasks" component={Home} />
    <Route path="/app/history" component={Home} />
    <Route path="/app/memory" component={Home} />
    <Route path="/app/files" component={Home} />
    <Route path="/app/agents" component={Home} />
    <Route path="/app/activity" component={Home} />
    <Route path="/app/tools" component={Home} />
    <Route path="/app/settings" component={Home} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
}

export default function App() {
  return <ErrorBoundary>
    <ThemeProvider defaultTheme="dark">
      <TooltipProvider>
        <Toaster theme="dark" />
        <AuthGate />
      </TooltipProvider>
    </ThemeProvider>
  </ErrorBoundary>;
}
