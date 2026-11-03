import { memo } from "react";
import {
  BaseEdge,
  Handle,
  Position,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { File } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { filePortId } from "./transfer-graph";

export function FileTransferPorts() {
  return [Position.Top, Position.Right, Position.Bottom, Position.Left].flatMap(
    (side) =>
      (["source", "target"] as const).map((kind) => (
        <Handle
          key={`${kind}-${side}`}
          id={filePortId(kind, side)}
          type={kind}
          position={side}
          isConnectable={false}
          aria-hidden="true"
          tabIndex={-1}
          className="file-transfer-port"
        />
      )),
  );
}

export const FileTransferEdge = memo(function FileTransferEdge(
  props: EdgeProps,
) {
  const [path] = getBezierPath(props);
  const { t } = useTranslation("files");
  const reducedMotion = useReducedMotion();
  const moving = props.data?.moving === true;
  return (
    <g>
      <title>{`${t("transferCount", { count: Number(props.data?.count) || 1 })} · ${t(String(props.data?.phase || "preparing"))}${props.data?.relay ? ` · ${t("viaLocal")}` : ""}\n${String(props.data?.title || "")}`}</title>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={18}
      />
      {moving &&
        !reducedMotion &&
        [0, 1].map((index) => (
          <g key={index} aria-hidden="true" className="file-transfer-packet">
            <animateMotion
              path={path}
              dur="3s"
              begin={`${index * -1.5}s`}
              rotate="0"
              repeatCount="indefinite"
            />
            <circle
              r="10"
              fill="var(--oria-color-bg)"
              stroke={props.style?.stroke}
              strokeOpacity="0.35"
            />
            <File
              x="-6"
              y="-7"
              size={13}
              color={String(props.style?.stroke)}
              strokeWidth={1.8}
            />
          </g>
        ))}
    </g>
  );
});
