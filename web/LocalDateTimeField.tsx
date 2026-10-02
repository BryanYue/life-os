import React, { useEffect, useId, useRef, useState } from "react";
import {
  resolveLocalDateTime,
  localDateTimeFromISO,
  type LocalDateTimeCandidate,
} from "../src/local-time.js";

export type LocalDateTimeFieldProps = {
  label: string;
  value: string;
  timeZone: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
};
export function LocalDateTimeField({
  label,
  value,
  timeZone,
  onChange,
  required,
  disabled,
}: LocalDateTimeFieldProps) {
  const fieldId = useId();
  const [local, setLocal] = useState("");
  const [candidates, setCandidates] = useState<LocalDateTimeCandidate[]>([]);
  const [offset, setOffset] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const lastEmitted = useRef<string | undefined>(undefined);
  const previousZone = useRef(timeZone);
  const callback = useRef(onChange);
  callback.current = onChange;
  const raw = useRef(local);
  raw.current = local;
  function emit(next: string) {
    lastEmitted.current = next;
    callback.current(next);
  }
  function evaluate(next: string, zone: string, existingISO?: string) {
    if (!next) {
      setCandidates([]);
      setOffset("");
      setError("");
      emit("");
      return;
    }
    try {
      const choices = resolveLocalDateTime(next, zone);
      setCandidates(choices);
      const chosen =
        existingISO !== undefined
          ? choices.find(
              (choice) => Date.parse(choice.iso) === Date.parse(existingISO),
            )
          : choices.length === 1
            ? choices[0]
            : undefined;
      setOffset(chosen?.offset ?? "");
      if (chosen) {
        setError("");
        emit(
          existingISO && existingISO.slice(0, 19) === next.slice(0, 19)
            ? existingISO
            : chosen.iso,
        );
      } else {
        setError(
          choices.length
            ? "这个钟点因夏令时重复，请选择 UTC 偏移。"
            : "这个钟点因时区切换不存在，请选择其他时间。",
        );
        emit("");
      }
    } catch (cause) {
      setCandidates([]);
      setOffset("");
      setError(cause instanceof Error ? cause.message : String(cause));
      emit("");
    }
  }
  useEffect(() => {
    const zoneChanged = previousZone.current !== timeZone;
    previousZone.current = timeZone;
    // The parent's echo must not erase an invalid or ambiguous wall time being edited.
    if (!zoneChanged && lastEmitted.current === value) {
      lastEmitted.current = undefined;
      return;
    }
    if (!value) {
      if (zoneChanged && raw.current) evaluate(raw.current, timeZone);
      else {
        setLocal("");
        setCandidates([]);
        setOffset("");
        setError("");
      }
      return;
    }
    try {
      const next = localDateTimeFromISO(value, timeZone);
      setLocal(next);
      evaluate(next, timeZone, value);
    } catch (cause) {
      setLocal(value.split(/[Z+]/)[0]);
      setCandidates([]);
      setOffset("");
      setError(cause instanceof Error ? cause.message : String(cause));
      emit("");
    }
  }, [value, timeZone]);
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  return (
    <div className="form-field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        aria-label={label}
        ref={input}
        type="datetime-local"
        step={local.includes(".") ? "0.001" : "1"}
        value={local}
        required={required}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${fieldId}-zone${error ? ` ${fieldId}-error` : ""}`}
        onChange={(event) => {
          const next = event.target.value;
          setLocal(next);
          evaluate(next, timeZone);
        }}
      />
      <span className="form-help" id={`${fieldId}-zone`}>
        时区：{timeZone}
      </span>
      {candidates.length > 1 && (
        <label className="form-field">
          重复钟点的 UTC 偏移
          <select
            aria-label={`${label} UTC偏移`}
            required
            disabled={disabled}
            value={offset}
            onChange={(event) => {
              const choice = candidates.find(
                (item) => item.offset === event.target.value,
              );
              setOffset(choice?.offset ?? "");
              setError(choice ? "" : "这个钟点因夏令时重复，请选择 UTC 偏移。");
              emit(choice?.iso ?? "");
            }}
          >
            <option value="">请选择对应的 UTC 偏移</option>
            {candidates.map((choice, index) => (
              <option key={choice.iso} value={choice.offset}>
                UTC{choice.offset}（{index === 0 ? "较早" : "较晚"}的时刻）
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <span id={`${fieldId}-error`} className="message error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
