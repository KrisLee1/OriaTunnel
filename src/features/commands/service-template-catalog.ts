import type {
  CommandInvocation,
  CommandArgument,
  ServiceTemplate,
  RemoteService,
} from "@/types";
import { renderInvocation } from "./command-invocation";
import {
  directServiceRecipes,
  directServiceTemplate,
} from "./direct-service-templates";
export const serviceTemplateCategories = [
  "development",
  "inference",
  "desktop",
  "generic",
  "web",
  "containers",
  "databases",
  "caches",
  "messaging",
  "observability",
  "storage",
] as const;
export type ServiceTemplateCategory =
  (typeof serviceTemplateCategories)[number];
// Picker groups are presentation only; services retain their original category.
export const serviceTemplateGroups = [
  ...serviceTemplateCategories,
  "systemd",
] as const;
export type ServiceTemplateGroup = (typeof serviceTemplateGroups)[number];
export interface BuiltinServiceTemplate {
  category: ServiceTemplateCategory;
  id: string;
  name: string;
  nameKey?: string;
  resource: string;
  manager: "direct" | "systemdUser" | "systemdSystem" | "docker";
  color: string;
  icon: string;
  source: string;
  launch?: CommandInvocation;
}
const positional = (value: string): CommandArgument => ({ name: "", value });
const option = (name: string, value: string | null): CommandArgument => ({
  name,
  value,
});
const launch = (
  executable: string,
  ...args: CommandArgument[]
): CommandInvocation => ({ executable, arguments: args });
// Recipes fill drafts only. Models and paths are examples, never installed or probed.
const managedServiceRecipes: BuiltinServiceTemplate[] = [
  {
    id: "tomcat",
    category: "web",
    name: "Tomcat",
    resource: "tomcat",
    manager: "systemdSystem",
    color: "#e8b45f",
    icon: "apachetomcat",
    source: "https://tomcat.apache.org/tomcat-11.0-doc/setup.html",
  },
  {
    id: "nginx",
    category: "web",
    name: "nginx",
    resource: "nginx",
    manager: "systemdSystem",
    color: "#67ad98",
    icon: "nginx",
    source: "https://nginx.org/en/docs/control.html",
  },
  {
    id: "dockerEngine",
    category: "containers",
    name: "Docker Engine",
    resource: "docker",
    manager: "systemdSystem",
    color: "#5b9fe6",
    icon: "docker",
    source: "https://docs.docker.com/engine/daemon/start/",
  },
  {
    id: "dockerContainer",
    nameKey: "templates.docker",
    category: "containers",
    name: "Docker container",
    resource: "my-container",
    manager: "docker",
    color: "#5b9fe6",
    icon: "docker",
    source: "https://docs.docker.com/reference/cli/docker/container/",
  },
  {
    id: "jupyter",
    category: "development",
    name: "JupyterLab",
    resource: "oria-jupyter",
    manager: "systemdUser",
    color: "#e8b45f",
    icon: "jupyter",
    source:
      "https://jupyterlab.readthedocs.io/en/stable/getting_started/starting.html",
    launch: launch(
      "jupyter",
      positional("lab"),
      option("--no-browser", null),
      option("--ip", "127.0.0.1"),
      option("--port", "8888"),
    ),
  },
  {
    id: "vnc",
    category: "desktop",
    name: "VNC · TigerVNC",
    resource: "oria-vnc",
    manager: "systemdUser",
    color: "#a58adf",
    icon: "remote-desktop",
    source:
      "https://manpages.debian.org/unstable/tigervnc-standalone-server/tigervncserver.1.en.html",
    launch: launch(
      "tigervncserver",
      positional(":1"),
      option("-fg", null),
      option("-localhost", "yes"),
    ),
  },
  {
    id: "gitea",
    category: "development",
    name: "Gitea",
    resource: "oria-gitea",
    manager: "systemdUser",
    color: "#67ad98",
    icon: "gitea",
    source: "https://docs.gitea.com/administration/command-line",
    launch: launch("gitea", positional("web"), option("--port", "3000")),
  },
  {
    id: "dsh",
    category: "inference",
    name: "DeepSeek Harness",
    resource: "oria-dsh",
    manager: "systemdUser",
    color: "#5b9fe6",
    icon: "dsh",
    source:
      "https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cli-help.md",
    launch: launch(
      "dsh",
      positional("web"),
      option("--port", "3080"),
      option("--host", "127.0.0.1"),
      option("--no-open", null),
    ),
  },
  {
    id: "ollama",
    category: "inference",
    name: "Ollama",
    resource: "oria-ollama",
    manager: "systemdUser",
    color: "#9ba6b5",
    icon: "ollama",
    source: "https://docs.ollama.com/cli",
    launch: launch("ollama", positional("serve")),
  },
  {
    id: "llamacpp",
    category: "inference",
    name: "llama.cpp",
    resource: "oria-llamacpp",
    manager: "systemdUser",
    color: "#a58adf",
    icon: "cpu",
    source:
      "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md",
    launch: launch(
      "llama-server",
      option("--model", "/path/to/model.gguf"),
      option("--host", "127.0.0.1"),
      option("--port", "8080"),
    ),
  },
  {
    id: "vllm",
    category: "inference",
    name: "vLLM",
    resource: "oria-vllm",
    manager: "systemdUser",
    color: "#58b9c8",
    icon: "brain",
    source: "https://docs.vllm.ai/en/latest/cli/serve/",
    launch: launch(
      "vllm",
      positional("serve"),
      positional("Qwen/Qwen3-0.6B"),
      option("--host", "127.0.0.1"),
      option("--port", "8000"),
    ),
  },
  {
    id: "sglang",
    category: "inference",
    name: "SGLang",
    resource: "oria-sglang",
    manager: "systemdUser",
    color: "#df7f78",
    icon: "brain",
    source:
      "https://github.com/sgl-project/sglang/blob/main/docs/docs/get-started/quickstart.mdx",
    launch: launch(
      "sglang",
      positional("serve"),
      positional("Qwen/Qwen3-0.6B"),
      option("--host", "127.0.0.1"),
      option("--port", "30000"),
    ),
  },
  {
    id: "xinference",
    category: "inference",
    name: "Xinference",
    resource: "oria-xinference",
    manager: "systemdUser",
    color: "#67ad98",
    icon: "brain",
    source:
      "https://inference.readthedocs.io/en/stable/getting_started/using_xinference.html",
    launch: launch(
      "xinference-local",
      option("--host", "127.0.0.1"),
      option("--port", "9997"),
    ),
  },
  {
    id: "lmdeploy",
    category: "inference",
    name: "LMDeploy",
    resource: "oria-lmdeploy",
    manager: "systemdUser",
    color: "#e8b45f",
    icon: "brain",
    source: "https://lmdeploy.readthedocs.io/en/latest/llm/api_server.html",
    launch: launch(
      "lmdeploy",
      positional("serve"),
      positional("api_server"),
      positional("internlm/internlm2_5-7b-chat"),
      option("--server-name", "127.0.0.1"),
      option("--server-port", "23333"),
    ),
  },
  {
    id: "tgi",
    category: "inference",
    name: "Hugging Face TGI",
    resource: "oria-tgi",
    manager: "systemdUser",
    color: "#e8b45f",
    icon: "huggingface",
    source:
      "https://huggingface.co/docs/text-generation-inference/en/basic_tutorials/launcher",
    launch: launch(
      "text-generation-launcher",
      option("--model-id", "Qwen/Qwen2.5-0.5B-Instruct"),
      option("--hostname", "127.0.0.1"),
      option("--port", "8080"),
    ),
  },
  {
    id: "tensorrt",
    category: "inference",
    name: "TensorRT-LLM",
    resource: "oria-tensorrt",
    manager: "systemdUser",
    color: "#67ad98",
    icon: "nvidia",
    source: "https://nvidia.github.io/TensorRT-LLM/commands/trtllm-serve.html",
    launch: launch(
      "trtllm-serve",
      positional("/path/to/model"),
      option("--host", "127.0.0.1"),
      option("--port", "8000"),
    ),
  },
  {
    id: "litellm",
    category: "inference",
    name: "LiteLLM",
    resource: "oria-litellm",
    manager: "systemdUser",
    color: "#a58adf",
    icon: "network",
    source: "https://docs.litellm.ai/docs/proxy/quick_start",
    launch: launch(
      "litellm",
      option("--model", "ollama/llama3.2"),
      option("--host", "127.0.0.1"),
      option("--port", "4000"),
    ),
  },
  {
    id: "postgresql",
    category: "databases",
    name: "PostgreSQL",
    resource: "postgresql",
    manager: "systemdSystem",
    color: "#5b9fe6",
    icon: "postgresql",
    source: "https://www.postgresql.org/docs/current/server-start.html",
  },
  {
    id: "mysql",
    category: "databases",
    name: "MySQL",
    resource: "mysql",
    manager: "systemdSystem",
    color: "#5b9fe6",
    icon: "mysql",
    source: "https://dev.mysql.com/doc/refman/8.4/en/using-systemd.html",
  },
  {
    id: "mariadb",
    category: "databases",
    name: "MariaDB",
    resource: "mariadb",
    manager: "systemdSystem",
    color: "#b89972",
    icon: "database",
    source:
      "https://mariadb.com/docs/server/server-management/starting-and-stopping-mariadb/systemd",
  },
  {
    id: "mongodb",
    category: "databases",
    name: "MongoDB",
    resource: "mongod",
    manager: "systemdSystem",
    color: "#67ad98",
    icon: "mongodb",
    source:
      "https://www.mongodb.com/docs/manual/administration/run-mongodb-systemd/",
  },
  {
    id: "elasticsearch",
    category: "databases",
    name: "Elasticsearch",
    resource: "elasticsearch",
    manager: "systemdSystem",
    color: "#e8b45f",
    icon: "elasticsearch",
    source:
      "https://www.elastic.co/docs/deploy-manage/deploy/self-managed/install-elasticsearch-with-debian-package",
  },
  {
    id: "redis",
    category: "caches",
    name: "Redis",
    resource: "redis-server",
    manager: "systemdSystem",
    color: "#df7f78",
    icon: "redis",
    source:
      "https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-linux/",
  },
  {
    id: "valkey",
    category: "caches",
    name: "Valkey",
    resource: "valkey",
    manager: "systemdSystem",
    color: "#58b9c8",
    icon: "database-fast",
    source: "https://valkey.io/topics/installation/",
  },
  {
    id: "memcached",
    category: "caches",
    name: "Memcached",
    resource: "memcached",
    manager: "systemdSystem",
    color: "#67ad98",
    icon: "memory",
    source: "https://docs.memcached.org/serverguide/",
  },
  {
    id: "rabbitmq",
    category: "messaging",
    name: "RabbitMQ",
    resource: "rabbitmq-server",
    manager: "systemdSystem",
    color: "#e8b45f",
    icon: "rabbitmq",
    source: "https://www.rabbitmq.com/docs/install-debian",
  },
  {
    id: "kafka",
    category: "messaging",
    name: "Apache Kafka",
    resource: "kafka",
    manager: "systemdSystem",
    color: "#9ba6b5",
    icon: "apachekafka",
    source: "https://kafka.apache.org/41/getting-started/quickstart/",
  },
  {
    id: "prometheus",
    category: "observability",
    name: "Prometheus",
    resource: "prometheus",
    manager: "systemdSystem",
    color: "#df7f78",
    icon: "prometheus",
    source: "https://prometheus.io/docs/prometheus/latest/getting_started/",
  },
  {
    id: "grafana",
    category: "observability",
    name: "Grafana",
    resource: "grafana-server",
    manager: "systemdSystem",
    color: "#e8b45f",
    icon: "grafana",
    source:
      "https://grafana.com/docs/grafana/latest/setup-grafana/start-restart-grafana/",
  },
  {
    id: "minio",
    category: "storage",
    name: "MinIO",
    resource: "minio",
    manager: "systemdSystem",
    color: "#df7f78",
    icon: "minio",
    source:
      "https://github.com/minio/minio-service/blob/master/linux-systemd/minio.service",
  },
  {
    id: "systemdUser",
    category: "generic",
    name: "systemd · User service",
    nameKey: "templates.systemdUser",
    resource: "my-service",
    manager: "systemdUser",
    color: "#9ba6b5",
    icon: "server-cog",
    source:
      "https://www.freedesktop.org/software/systemd/man/latest/systemctl.html",
  },
  {
    id: "systemdSystem",
    category: "generic",
    name: "systemd · System service",
    nameKey: "templates.systemdSystem",
    resource: "my-service",
    manager: "systemdSystem",
    color: "#9ba6b5",
    icon: "server-cog",
    source:
      "https://www.freedesktop.org/software/systemd/man/latest/systemctl.html",
  },
];
// Plain names always import native commands. Managed versions are separate,
// explicitly named choices; saved user services are never rewritten.
export const builtinServiceTemplates: BuiltinServiceTemplate[] = [
  ...managedServiceRecipes
    .filter((preset) => preset.category !== "generic")
    .map((preset) => ({
      ...preset,
      manager: "direct" as const,
      source: directServiceRecipes[preset.id]?.source || preset.source,
      launch:
        directServiceRecipes[preset.id]?.actions.find((a) => a.kind === "start")
          ?.invocation || preset.launch,
    })),
  ...managedServiceRecipes.filter((preset) => preset.category === "generic"),
  ...managedServiceRecipes
    .filter(
      (preset) => preset.category !== "generic" && preset.manager !== "docker",
    )
    .map((preset) => ({
      ...preset,
      id: `${preset.id}-systemd`,
      name: `${preset.name} · systemd`,
      nameKey: undefined,
    })),
];
export function localizedServiceTemplates(
  translate: (key: string) => string,
): BuiltinServiceTemplate[] {
  return builtinServiceTemplates.map((preset) => ({
    ...preset,
    name: preset.nameKey ? translate(preset.nameKey) : preset.name,
  }));
}
export function applyLaunchTemplate(
  base: ServiceTemplate,
  preset: BuiltinServiceTemplate | undefined,
  invocation: CommandInvocation | undefined,
): ServiceTemplate {
  if (!preset) return base;
  if (preset.manager === "direct")
    return directServiceTemplate({
      ...preset,
      launch: invocation || preset.launch,
    });
  const result: ServiceTemplate = {
    ...base,
    name: preset.name,
    category: preset.category,
    color: preset.color,
    icon: { kind: "builtin", value: preset.icon },
    actions: base.actions.map((a) => ({ ...a })),
  };
  if (!invocation) return result;
  const managed: CommandInvocation = {
    executable: "systemd-run",
    ...(invocation.environment
      ? { environment: structuredClone(invocation.environment) }
      : {}),
    arguments: [
      option("--user", null),
      option("--unit", base.resource),
      option("--collect", null),
      option("--", null),
      positional(invocation.executable),
      // systemd expands dollar signs again after the POSIX shell. Use its
      // documented $$ escape, compatible with older systemd (no v254 switch).
      ...invocation.arguments.map((arg) => ({
        ...arg,
        value: arg.value?.replaceAll("$", () => "$$") ?? null,
      })),
    ],
  };
  const start = result.actions.find((a) => a.kind === "start")!;
  start.invocation = managed;
  start.command = renderInvocation(managed);
  const status = result.actions.find((a) => a.kind === "status")!;
  status.command = status.command.replace(
    ' || exit 5\n[ "$load" = loaded ] || exit 5',
    '\nload_result=$?\n[ "$load" != not-found ] || exit 3\n[ "$load_result" -eq 0 ] && [ "$load" = loaded ] || exit 5',
  );
  const restart = result.actions.find((a) => a.kind === "restart")!;
  const unit = "'" + base.resource.replaceAll("'", `'"'"'`) + "'";
  restart.command = `load=$(systemctl --user show --property=LoadState --value -- ${unit})\nload_result=$?\nif [ "$load" = not-found ]; then\n${start.command}\nelif [ "$load_result" -eq 0 ] && [ "$load" = loaded ]; then\n${restart.command}\nelse\nexit 5\nfi`;
  return result;
}

// Replace the editable template as a whole; identity, references and permission
// belong to the existing service and must not be imported from a recipe.
export function fillServiceTemplate(
  draft: RemoteService,
  template: ServiceTemplate,
): RemoteService {
  return {
    ...draft,
    name: template.name || template.resource,
    category: template.category ?? "other",
    color: template.color ?? null,
    icon: template.icon ? structuredClone(template.icon) : null,
    actions: structuredClone(template.actions),
    control: structuredClone(template.control),
  };
}

export function groupServiceTemplates(
  options: BuiltinServiceTemplate[],
  query: string,
  categoryNames: Record<ServiceTemplateGroup, string>,
) {
  const words = query
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return serviceTemplateGroups
    .map((category) => ({
      category,
      name: categoryNames[category],
      templates: options.filter((template) => {
        const group =
          template.manager === "systemdUser" ||
          template.manager === "systemdSystem"
            ? "systemd"
            : template.category;
        if (group !== category) return false;
        const text =
          `${template.name} ${template.id} ${template.resource} ${categoryNames[category]} ${categoryNames[template.category]}`
            .normalize("NFKC")
            .toLocaleLowerCase();
        return words.every((word) => text.includes(word));
      }),
    }))
    .filter((group) => group.templates.length > 0);
}

export function serviceCategory(
  service: Pick<RemoteService, "category" | "name" | "icon">,
): string {
  if (
    service.category === "other" ||
    serviceTemplateCategories.includes(
      service.category as ServiceTemplateCategory,
    )
  )
    return service.category!;
  const byName = builtinServiceTemplates.find(
    (preset) =>
      preset.name.toLocaleLowerCase() ===
      service.name.trim().toLocaleLowerCase(),
  );
  if (byName) return byName.category;
  const candidates = builtinServiceTemplates.filter(
    (preset) =>
      service.icon?.kind === "builtin" && preset.icon === service.icon.value,
  );
  const categories = new Set(candidates.map((preset) => preset.category));
  return categories.size === 1 ? candidates[0].category : "other";
}
export function groupServices(services: RemoteService[]) {
  return [...serviceTemplateCategories, "other"]
    .map((category) => ({
      category,
      services: services.filter(
        (service) => serviceCategory(service) === category,
      ),
    }))
    .filter((group) => group.services.length);
}
