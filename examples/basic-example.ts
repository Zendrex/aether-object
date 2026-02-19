import { Aether } from "../src/index.ts";
import { logger } from "./logger.ts";

// ---------------------------------------------------------------------------
// Plugin: command registry
// Demonstrates: use(), state, factory decorators, extensions
// ---------------------------------------------------------------------------

type CommandHandler = (args: string[]) => void | Promise<void>;

const commands = new Aether("commands")
	.use(logger)
	.state("commands", new Map<string, CommandHandler>(), { scope: "global" })
	.decorate(
		"runCommand",
		({ store, log }) =>
			async (name: string, ...args: string[]) => {
				const handler = store.commands.get(name);
				if (!handler) {
					log.error(`Unknown command: ${name}`);
					return;
				}
				await handler(args);
			},
		{ scope: "global" },
	)
	.extend("command", function (name: string, handler: CommandHandler) {
		return this.onLoad(({ store, log }) => {
			store.commands.set(name, handler);
			log.info(`Registered command: ${name}`);
		});
	});

// ---------------------------------------------------------------------------
// App: composes plugins, adds server decorator, runs lifecycle
// Demonstrates: chaining, object-form decorate, lifecycle hooks, extensions
// ---------------------------------------------------------------------------

const app = new Aether("app")
	.use(commands)
	.ext.command("ping", () => console.log("Pong!"))
	.ext.command("status", () => console.log("All systems operational"))
	.decorate("port", 3000)
	.decorate("server", (ctx) => ({
		url: `http://localhost:${ctx.port}`,
		start() {
			ctx.log.info(`Listening on ${this.url}`);
		},
		stop() {
			ctx.log.info("Server stopped");
		},
	}))
	.onLoad(({ server, log }) => {
		server.start();
		log.info("Application ready");
	})
	.onUnload(({ server, log }) => {
		log.info("Shutting down...");
		server.stop();
	});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	await app.start();
	console.log(`Running: ${app.isRunning}`);

	await app.context.runCommand("ping");
	await app.context.runCommand("status");

	await app.stop();
	console.log(`Running: ${app.isRunning}`);
}

if (import.meta.main) {
	main().catch(console.error);
}
