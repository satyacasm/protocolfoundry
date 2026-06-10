import express, { type Express } from "express";
import { randomUUID } from "node:crypto";

interface Task {
  id: string;
  title: string;
  assignee?: string;
  done: boolean;
}

/**
 * Mock upstream Taskboard API matching examples/taskboard/openapi.json.
 * Requires X-API-Key auth, like a real SaaS would — this is the application
 * the generated MCP server fronts in the Phase 1 end-to-end validation.
 */
export function createTaskboardApp(apiKey: string): Express {
  const tasks = new Map<string, Task>();
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (req.headers["x-api-key"] !== apiKey) {
      res.status(401).json({ error: "invalid API key" });
      return;
    }
    next();
  });

  app.get("/tasks", (req, res) => {
    let all = [...tasks.values()];
    if (req.query.done !== undefined) {
      const done = req.query.done === "true";
      all = all.filter((t) => t.done === done);
    }
    res.json(all);
  });

  app.post("/tasks", (req, res) => {
    const { title, assignee } = req.body ?? {};
    if (typeof title !== "string" || title.length === 0) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const task: Task = { id: randomUUID(), title, done: false, ...(assignee ? { assignee } : {}) };
    tasks.set(task.id, task);
    res.status(201).json(task);
  });

  app.get("/tasks/:id", (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json(task);
  });

  app.post("/tasks/:id/complete", (req, res) => {
    const task = tasks.get(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    task.done = true;
    res.json(task);
  });

  app.delete("/tasks/:id", (req, res) => {
    if (!tasks.delete(req.params.id)) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.status(204).end();
  });

  return app;
}
