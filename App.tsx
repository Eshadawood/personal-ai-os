import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/app" component={Home} />
      <Route path="/app/overview" component={Home} />
      <Route path="/app/chat" component={Home} />
      <Route path="/app/goals" component={Home} />
      <Route path="/app/tasks" component={Home} />
      <Route path="/app/memory" component={Home} />
      <Route path="/app/files" component={Home} />
      <Route path="/app/agents" component={Home} />
      <Route path="/app/activity" component={Home} />
      <Route path="/app/tools" component={Home} />
      <Route path="/app/settings" component={Home} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
