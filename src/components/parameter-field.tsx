import {
  cloneElement,
  useId,
  type ComponentProps,
  type ReactElement,
} from "react";
import { CircleQuestionMark } from "lucide-react";
import { InfoTooltip } from "./ui/info-tooltip";
import { Switch } from "./ui/switch";

type ParameterInfo = { label: string; parameter?: string; description: string };

export function ParameterTitle({
  label,
  parameter,
  description,
  htmlFor,
}: ParameterInfo & { htmlFor?: string }) {
  const Title = htmlFor ? "label" : "span";
  return (
    <span className="parameter-title">
      <Title htmlFor={htmlFor}>
        {label}
        {parameter && <span className="parameter-name">（{parameter}）</span>}
      </Title>
      <InfoTooltip
        label={label}
        description={description}
        icon={CircleQuestionMark}
      />
    </span>
  );
}

export function ParameterField({
  children,
  layout = "stacked",
  unit,
  ...info
}: ParameterInfo & {
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  layout?: "stacked" | "inline";
  unit?: string;
}) {
  const id = useId();
  const unitId = `${id}-unit`;
  return (
    <div className={`field parameter-field parameter-field-${layout}`}>
      <ParameterTitle {...info} htmlFor={id} />
      <div className="parameter-control">
        {cloneElement(children, {
          id,
          "aria-describedby":
            [children.props["aria-describedby"], unit ? unitId : undefined]
              .filter(Boolean)
              .join(" ") || undefined,
        })}
        {unit && (
          <span id={unitId} className="parameter-unit">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

export function ParameterSwitch({
  label,
  parameter,
  description,
  ...props
}: ParameterInfo & Omit<ComponentProps<typeof Switch>, "id" | "children">) {
  const id = useId();
  return (
    <div className="parameter-switch">
      <ParameterTitle
        label={label}
        parameter={parameter}
        description={description}
        htmlFor={id}
      />
      <Switch {...props} id={id} />
    </div>
  );
}
