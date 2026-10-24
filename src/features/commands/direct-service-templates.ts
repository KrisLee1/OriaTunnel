import type {
  CommandInvocation,
  CommandKind,
  PresetAction,
  ServiceTemplate,
} from "@/types";
import { renderInvocation } from "./command-invocation";

interface DirectAction {
  kind: CommandKind;
  label?: "reload" | "checkConfig";
  invocation?: CommandInvocation;
  script?: string;
  terminal?: boolean;
}
export interface DirectRecipe {
  source?: string;
  actions: DirectAction[];
}
const command = (executable: string, ...args: string[]): CommandInvocation => {
  const parameters: CommandInvocation["arguments"] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value.startsWith("-")) {
      const next = args[index + 1];
      const paired = next !== undefined && !next.startsWith("-");
      parameters.push({ name: value, value: paired ? args[++index] : null });
    } else parameters.push({ name: "", value });
  }
  return { executable, arguments: parameters };
};
const action = (
  kind: CommandKind,
  executable: string,
  ...args: string[]
): DirectAction => ({
  kind,
  invocation: command(executable, ...args),
});
const foreground = (executable: string, ...args: string[]): DirectAction => ({
  ...action("start", executable, ...args),
  terminal: true,
});

// Native lifecycle commands only. Foreground processes stay in a dedicated PTY;
// services without a native stop command are stopped in that terminal (Ctrl+C).
// Data/configuration paths are editable examples; nothing is installed or initialized.
export const directServiceRecipes: Record<string, DirectRecipe> = {
  tomcat: {
    source: "https://github.com/apache/tomcat/blob/main/bin/catalina.sh",
    actions: [
      foreground("catalina.sh", "run"),
      action("stop", "catalina.sh", "stop"),
      {
        ...action("custom", "catalina.sh", "configtest"),
        label: "checkConfig",
      },
    ],
  },
  nginx: {
    source: "https://nginx.org/en/docs/switches.html",
    actions: [
      action("start", "nginx"),
      action("stop", "nginx", "-s", "quit"),
      { ...action("custom", "nginx", "-s", "reload"), label: "reload" },
      { ...action("custom", "nginx", "-t"), label: "checkConfig" },
    ],
  },
  dockerEngine: {
    actions: [foreground("dockerd"), action("status", "docker", "info")],
  },
  dockerContainer: {
    actions: [
      action("start", "docker", "start", "my-container"),
      action("stop", "docker", "stop", "my-container"),
      action("restart", "docker", "restart", "my-container"),
      action(
        "status",
        "docker",
        "inspect",
        "--format",
        "{{.State.Status}}",
        "my-container",
      ),
      action("logs", "docker", "logs", "--tail", "100", "my-container"),
    ],
  },
  jupyter: {
    actions: [
      action("stop", "jupyter", "server", "stop", "8888"),
      action("status", "jupyter", "server", "list"),
    ],
  },
  vnc: {
    source:
      "https://manpages.debian.org/unstable/tigervnc-standalone-server/tigervncserver.1.en.html",
    actions: [
      action("start", "vncserver", ":1", "-localhost", "yes"),
      action("stop", "vncserver", "-kill", ":1"),
      {
        kind: "restart",
        script: "vncserver -kill :1 && vncserver :1 -localhost yes",
      },
      action("status", "vncserver", "-list"),
    ],
  },
  // Existing model/application recipes supply their own direct launch below.
  gitea: { actions: [] },
  dsh: { actions: [foreground("dsh", "web", "--port", "3080")] },
  ollama: { actions: [action("status", "ollama", "list")] },
  llamacpp: { actions: [] },
  vllm: { actions: [] },
  sglang: { actions: [] },
  xinference: { actions: [] },
  lmdeploy: { actions: [] },
  tgi: { actions: [] },
  tensorrt: { actions: [] },
  litellm: { actions: [] },
  postgresql: {
    source: "https://www.postgresql.org/docs/current/app-pg-ctl.html",
    actions: [
      action(
        "start",
        "pg_ctl",
        "-D",
        "/path/to/data",
        "-l",
        "/path/to/postgresql.log",
        "start",
      ),
      action("stop", "pg_ctl", "-D", "/path/to/data", "-m", "fast", "stop"),
      action(
        "restart",
        "pg_ctl",
        "-D",
        "/path/to/data",
        "-m",
        "fast",
        "restart",
      ),
      action("status", "pg_ctl", "-D", "/path/to/data", "status"),
      action("logs", "tail", "-n", "100", "/path/to/postgresql.log"),
    ],
  },
  mysql: {
    source: "https://dev.mysql.com/doc/refman/8.4/en/mysqladmin.html",
    actions: [
      foreground("mysqld"),
      action("stop", "mysqladmin", "shutdown"),
      action("status", "mysqladmin", "ping"),
    ],
  },
  mariadb: {
    source:
      "https://mariadb.com/docs/server/clients-and-utilities/administrative-tools/mariadb-admin",
    actions: [
      foreground("mariadbd"),
      action("stop", "mariadb-admin", "shutdown"),
      action("status", "mariadb-admin", "ping"),
    ],
  },
  mongodb: {
    source: "https://www.mongodb.com/docs/manual/reference/program/mongod/",
    actions: [
      foreground(
        "mongod",
        "--dbpath",
        "/path/to/data",
        "--bind_ip",
        "127.0.0.1",
      ),
      action(
        "stop",
        "mongosh",
        "--quiet",
        "--eval",
        'db.getSiblingDB("admin").shutdownServer()',
      ),
      action(
        "status",
        "mongosh",
        "--quiet",
        "--eval",
        "db.adminCommand({ping:1})",
      ),
    ],
  },
  elasticsearch: {
    source:
      "https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-from-archive-on-linux-macos",
    actions: [foreground("elasticsearch")],
  },
  redis: {
    source:
      "https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/",
    actions: [
      foreground("redis-server", "--bind", "127.0.0.1"),
      action("stop", "redis-cli", "shutdown"),
      action("status", "redis-cli", "ping"),
    ],
  },
  valkey: {
    actions: [
      foreground("valkey-server", "--bind", "127.0.0.1"),
      action("stop", "valkey-cli", "shutdown"),
      action("status", "valkey-cli", "ping"),
    ],
  },
  memcached: {
    actions: [
      foreground("memcached", "-l", "127.0.0.1", "-m", "64", "-p", "11211"),
    ],
  },
  rabbitmq: {
    source: "https://www.rabbitmq.com/docs/man/rabbitmq-server.8",
    actions: [
      foreground("rabbitmq-server"),
      action("stop", "rabbitmqctl", "stop"),
      action("status", "rabbitmqctl", "status"),
    ],
  },
  kafka: {
    actions: [
      foreground(
        "kafka-server-start.sh",
        "/path/to/kafka/config/server.properties",
      ),
    ],
  },
  prometheus: {
    actions: [
      foreground(
        "prometheus",
        "--config.file",
        "/path/to/prometheus.yml",
        "--web.listen-address",
        "127.0.0.1:9090",
      ),
    ],
  },
  grafana: {
    actions: [
      foreground("grafana", "server", "--homepath", "/path/to/grafana"),
    ],
  },
  minio: {
    source: "https://github.com/minio/minio/blob/master/docs/config/README.md",
    actions: [
      foreground(
        "minio",
        "server",
        "/path/to/data",
        "--address",
        "127.0.0.1:9000",
        "--console-address",
        "127.0.0.1:9001",
      ),
    ],
  },
};

export function directServiceTemplate(preset: {
  id: string;
  name: string;
  category: string;
  color: string;
  icon: string;
  resource: string;
  launch?: CommandInvocation;
}): ServiceTemplate {
  const recipe = directServiceRecipes[preset.id];
  if (!recipe) throw new Error("templateUnsupported");
  const definitions = [...recipe.actions];
  if (!definitions.some((a) => a.kind === "start") && preset.launch)
    definitions.unshift({
      kind: "start",
      invocation: structuredClone(preset.launch),
      terminal: true,
    });
  else if (preset.launch) {
    const start = definitions.findIndex((a) => a.kind === "start");
    definitions[start] = {
      ...definitions[start],
      invocation: structuredClone(preset.launch),
    };
  }
  if (!definitions.some((a) => a.kind === "start"))
    throw new Error("templateUnsupported");
  const actions: PresetAction[] = definitions.map((definition) => ({
    id: crypto.randomUUID(),
    kind: definition.kind,
    label: definition.label || definition.kind,
    invocation: definition.invocation
      ? structuredClone(definition.invocation)
      : undefined,
    command: definition.invocation
      ? renderInvocation(definition.invocation)
      : definition.script!,
    mode: definition.terminal ? "terminal" : "command",
    timeoutSecs: definition.terminal
      ? 0
      : definition.kind === "status"
        ? 15
        : 60,
    successCodes: [0],
    confirm:
      definition.kind === "stop" ||
      definition.kind === "restart" ||
      definition.label === "reload",
  }));
  const start = actions.find((a) => a.kind === "start")!;
  return {
    name: preset.name,
    category: preset.category,
    color: preset.color,
    icon: { kind: "builtin", value: preset.icon },
    resource: preset.resource,
    shell: "POSIX sh",
    actions,
    control: {
      // CLI success (e.g. docker inspect or vncserver -list) does not prove this
      // instance is running. Do not inherit systemd exit-code mappings/probes.
      statusProbe: null,
      healthProbe: null,
      startActionId: start.mode === "command" ? start.id : null,
      checkAfterActions: false,
      ttlSecs: 60,
    },
  };
}
