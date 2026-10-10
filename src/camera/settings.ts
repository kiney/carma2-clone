const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

interface LabeledValues {
  label: string;
  count: number;
}

function parseValues(text: string, label: string, count: number): number[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== count || tokens.some((token) => !NUMBER.test(token)))
    throw new Error(`Invalid GENERAL camera ${label} field`);
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error(`Invalid GENERAL camera ${label} field`);
  return values;
}

function readLabeledValues(text: string, field: LabeledValues): number[] {
  const lines = text.split(/\r?\n/);
  const matches: { line: number; valueText: string }[] = [];
  const labelPattern = new RegExp(field.label, "i");
  for (let index = 0; index < lines.length; index++) {
    const commentIndex = lines[index].indexOf("//");
    if (commentIndex < 0) continue;
    const comment = lines[index].slice(commentIndex + 2).trim();
    if (!labelPattern.test(comment)) continue;
    matches.push({
      line: index,
      valueText: lines[index].slice(0, commentIndex).trim(),
    });
  }
  if (matches.length !== 1)
    throw new Error(`GENERAL must contain one camera ${field.label} label`);

  const match = matches[0];
  if (match.valueText)
    return parseValues(match.valueText, field.label, field.count);
  for (const line of lines.slice(match.line + 1)) {
    const valueText = line.split("//", 1)[0].trim();
    if (!valueText) continue;
    return parseValues(valueText, field.label, field.count);
  }
  throw new Error(`Missing GENERAL camera ${field.label} value`);
}

/** Camera fields read from GENERAL's Hithers, Yon and Camera angle records. */
export interface CameraSettings {
  hitherGeneral: number;
  hitherCockpit: number;
  far: number;
  /** Authored degrees before BRender's 16-bit angular conversion. */
  fovDegrees: number;
  fovAngle16: number;
  /** Perspective angle represented by the quantized BRender value. */
  runtimeFovDegrees: number;
}

/** Parse only the three labeled camera settings, independent of GENERAL order. */
export function parseCameraSettings(text: string): CameraSettings {
  const [generalHither, cockpitHither] = readLabeledValues(text, {
    label: "^hithers\\s*,\\s*general\\s+then\\s+cockpit\\s+mode\\s*$",
    count: 2,
  });
  const [far] = readLabeledValues(text, {
    label: "^yon\\s*$",
    count: 1,
  });
  const [fovDegrees] = readLabeledValues(text, {
    label: "^camera\\s+angle\\s*$",
    count: 1,
  });

  const nativeHitherGeneral = Math.fround(generalHither);
  const nativeHitherCockpit = Math.fround(cockpitHither);
  const hitherGeneral = Math.fround(nativeHitherGeneral * 2);
  const hitherCockpit = Math.fround(nativeHitherCockpit * 2);
  if (
    !(hitherGeneral > 0 && hitherGeneral <= 1000) ||
    !(hitherCockpit > 0 && hitherCockpit <= 1000) ||
    !(far > 0 && far <= 1_000_000) ||
    !(far > Math.max(hitherGeneral, hitherCockpit)) ||
    !(fovDegrees > 0 && fovDegrees < 180)
  )
    throw new Error("GENERAL camera settings are outside supported bounds");

  const fovAngle16 = Math.trunc((fovDegrees * 65536) / 360);
  if (fovAngle16 <= 0)
    throw new Error("GENERAL camera angle quantizes to zero");
  return {
    hitherGeneral,
    hitherCockpit,
    far,
    fovDegrees,
    fovAngle16,
    runtimeFovDegrees: (fovAngle16 * 360) / 65536,
  };
}
