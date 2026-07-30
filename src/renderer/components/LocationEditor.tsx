/**
 * Location Editor
 *
 * Single-location editing panel: latitude/longitude (required) plus
 * altitude, speed, heading, and accuracy (optional, capability-gated).
 *
 * Validation happens locally — invalid input never reaches IPC.
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Button, Chip, Input, Label, TextField, Typography } from '@heroui/react';
import type { Coordinate, Device } from '@shared/types/index.js';
import { validateCoordinate } from '@shared/coordinateValidation.js';
import { useRouteStore } from '@/state/routeStore.js';
import { useDeviceStore } from '@/state/deviceStore.js';

const { Heading, Paragraph } = Typography;

interface FieldDef {
  key: OptionalFieldKey;
  label: string;
  placeholder: string;
  capability: 'altitude' | 'speed' | 'heading' | 'accuracy';
  unsupportedHint: string;
}

type OptionalFieldKey = 'altitude' | 'speed' | 'heading' | 'accuracy';

const OPTIONAL_FIELDS: FieldDef[] = [
  {
    key: 'altitude',
    label: 'Altitude (m)',
    placeholder: '20',
    capability: 'altitude',
    unsupportedHint: 'This target does not support altitude simulation.',
  },
  {
    key: 'speed',
    label: 'Speed (m/s)',
    placeholder: '1.4',
    capability: 'speed',
    unsupportedHint: 'This target does not support speed simulation.',
  },
  {
    key: 'heading',
    label: 'Heading (°)',
    placeholder: '90',
    capability: 'heading',
    unsupportedHint: 'This target does not support heading simulation.',
  },
  {
    key: 'accuracy',
    label: 'Accuracy (m)',
    placeholder: '5',
    capability: 'accuracy',
    unsupportedHint: 'This target does not support accuracy simulation.',
  },
];

interface FieldValues {
  latitude: string;
  longitude: string;
  altitude: string;
  speed: string;
  heading: string;
  accuracy: string;
}

const EMPTY_FIELDS: FieldValues = {
  latitude: '',
  longitude: '',
  altitude: '',
  speed: '',
  heading: '',
  accuracy: '',
};

/**
 * Builds a Coordinate from the text fields, filtering optional fields the
 * device doesn't support. Returns field-level parse errors for non-numeric
 * text; range validation is delegated to validateCoordinate.
 */
const buildCoordinate = (
  fields: FieldValues,
  device: Device | undefined
): { coordinate: Coordinate | null; errors: string[] } => {
  const errors: string[] = [];

  const parse = (label: string, text: string): number | undefined => {
    if (text.trim() === '') return undefined;
    const value = Number(text);
    if (!Number.isFinite(value)) {
      errors.push(`${label} must be a number.`);
      return undefined;
    }
    return value;
  };

  const latitude = parse('Latitude', fields.latitude);
  const longitude = parse('Longitude', fields.longitude);
  if (fields.latitude.trim() === '') errors.push('Latitude is required.');
  if (fields.longitude.trim() === '') errors.push('Longitude is required.');

  const altitude = parse('Altitude', fields.altitude);
  const speed = parse('Speed', fields.speed);
  const heading = parse('Heading', fields.heading);
  const accuracy = parse('Accuracy', fields.accuracy);

  if (errors.length > 0 || latitude === undefined || longitude === undefined) {
    return { coordinate: null, errors };
  }

  const caps = device?.capabilities;
  const coordinate: Coordinate = {
    latitude,
    longitude,
    ...(altitude !== undefined && caps?.altitude ? { altitude } : {}),
    ...(speed !== undefined && caps?.speed ? { speed } : {}),
    ...(heading !== undefined && caps?.heading ? { heading } : {}),
    ...(accuracy !== undefined && caps?.accuracy ? { accuracy } : {}),
  };

  const validation = validateCoordinate(coordinate);
  if (!validation.valid) {
    return { coordinate: null, errors: validation.errors };
  }

  return { coordinate, errors: [] };
};

const formatNumber = (value: number | undefined): string => (value === undefined ? '' : String(value));

export const LocationEditor = (): JSX.Element => {
  const {
    pendingCoordinate,
    lastAppliedCoordinate,
    locationError,
    mapInteractionMode,
    setMapInteractionMode,
    setPendingCoordinate,
    setLocation,
    resetLocation,
    clearLocationError,
  } = useRouteStore();
  const { getSelectedDevice } = useDeviceStore();
  const selectedDevice = getSelectedDevice();

  const [fields, setFields] = useState<FieldValues>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // Map clicks/drags update the pending coordinate → reflect into fields.
  useEffect(() => {
    if (!pendingCoordinate) return;
    setFields((current) => ({
      ...current,
      latitude: pendingCoordinate.latitude.toFixed(6),
      longitude: pendingCoordinate.longitude.toFixed(6),
    }));
    setStatusMessage(null);
  }, [pendingCoordinate]);

  const setField = (key: keyof FieldValues, value: string): void => {
    setFields((current) => ({ ...current, [key]: value }));
    setFieldErrors([]);
    setStatusMessage(null);
    clearLocationError();
  };

  const capabilities = selectedDevice?.capabilities;
  const canSet = capabilities?.setLocation ?? false;
  const canReset = capabilities?.resetLocation ?? false;

  const handleApply = async (): Promise<void> => {
    if (!selectedDevice) {
      setFieldErrors(['No device is selected.']);
      return;
    }
    const { coordinate, errors } = buildCoordinate(fields, selectedDevice);
    if (!coordinate) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors([]);
    setIsApplying(true);
    try {
      const ok = await setLocation(selectedDevice.id, coordinate);
      if (ok) {
        setPendingCoordinate(coordinate);
        setStatusMessage('Location applied.');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    if (!selectedDevice) {
      setFieldErrors(['No device is selected.']);
      return;
    }
    setFieldErrors([]);
    setIsApplying(true);
    try {
      const ok = await resetLocation(selectedDevice.id);
      if (ok) {
        setStatusMessage('Location reset to real position.');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    if (!selectedDevice || !lastAppliedCoordinate) return;
    setIsApplying(true);
    try {
      const ok = await setLocation(selectedDevice.id, lastAppliedCoordinate);
      if (ok) {
        setStatusMessage('Location re-sent.');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    const { coordinate, errors } = buildCoordinate(fields, selectedDevice);
    if (!coordinate) {
      setFieldErrors(errors);
      return;
    }
    await navigator.clipboard.writeText(
      `${coordinate.latitude}, ${coordinate.longitude}`
    );
    setStatusMessage('Coordinates copied.');
  };

  const handlePaste = async (): Promise<void> => {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) return;

    // Minimal formats for Stage 1: "lat, lng", "lat lng", or JSON with
    // latitude/longitude (or lat/lng) keys. Full text parsing is Stage 5.
    let latitude: number | undefined;
    let longitude: number | undefined;

    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const latRaw = json['latitude'] ?? json['lat'];
      const lngRaw = json['longitude'] ?? json['lng'] ?? json['lon'];
      if (typeof latRaw === 'number') latitude = latRaw;
      if (typeof lngRaw === 'number') longitude = lngRaw;
    } catch {
      const parts = text.split(/[,\s]+/).filter(Boolean);
      if (parts.length >= 2 && parts[0] !== undefined && parts[1] !== undefined) {
        const lat = Number(parts[0]);
        const lng = Number(parts[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          latitude = lat;
          longitude = lng;
        }
      }
    }

    if (latitude === undefined || longitude === undefined) {
      setFieldErrors(['Could not parse coordinates from clipboard. Expected "lat, lng".']);
      return;
    }

    setFields((current) => ({
      ...current,
      latitude: String(latitude),
      longitude: String(longitude),
    }));
    setFieldErrors([]);
    setStatusMessage('Coordinates pasted.');
  };

  const handleUseMapSelection = (): void => {
    setMapInteractionMode('select-location');
    if (pendingCoordinate) {
      setFields((current) => ({
        ...current,
        latitude: pendingCoordinate.latitude.toFixed(6),
        longitude: pendingCoordinate.longitude.toFixed(6),
      }));
    } else {
      setStatusMessage('Click the map to choose a location.');
    }
  };

  const errorsToShow = fieldErrors.length > 0 ? fieldErrors : locationError ? [locationError] : [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Heading level={6} style={{ margin: 0 }}>
          Location
        </Heading>
        {selectedDevice ? (
          <Chip size="sm" color={canSet ? 'success' : 'default'} variant="soft">
            {canSet ? 'Supported' : 'Unsupported'}
          </Chip>
        ) : (
          <Chip size="sm" color="default" variant="soft">
            No device
          </Chip>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <TextField
          value={fields.latitude}
          onChange={(value: string) => setField('latitude', value)}
          isDisabled={!canSet}
        >
          <Label>Latitude</Label>
          <Input placeholder="37.7749" />
        </TextField>
        <TextField
          value={fields.longitude}
          onChange={(value: string) => setField('longitude', value)}
          isDisabled={!canSet}
        >
          <Label>Longitude</Label>
          <Input placeholder="-122.4194" />
        </TextField>

        {OPTIONAL_FIELDS.map((field) => {
          const supported = capabilities?.[field.capability] ?? false;
          return (
            <div
              key={field.key}
              title={selectedDevice && !supported ? field.unsupportedHint : undefined}
            >
              <TextField
                value={fields[field.key]}
                onChange={(value: string) => setField(field.key, value)}
                isDisabled={!canSet || !supported}
                fullWidth
              >
                <Label>{field.label}</Label>
                <Input placeholder={supported ? field.placeholder : 'Not supported'} />
              </TextField>
            </div>
          );
        })}
      </div>

      {errorsToShow.length > 0 && (
        <div>
          {errorsToShow.map((error) => (
            <Paragraph key={error} size="xs" style={{ margin: 0, color: 'var(--color-danger)' }}>
              {error}
            </Paragraph>
          ))}
        </div>
      )}

      {statusMessage && errorsToShow.length === 0 && (
        <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
          {statusMessage}
        </Paragraph>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button
          variant="primary"
          size="sm"
          onPress={handleApply}
          isDisabled={!selectedDevice || !canSet || isApplying}
        >
          Apply Location
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleReset}
          isDisabled={!selectedDevice || !canReset || isApplying}
        >
          Reset Location
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onPress={handleResend}
          isDisabled={!selectedDevice || !canSet || !lastAppliedCoordinate || isApplying}
        >
          Re-send
        </Button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button
          variant={mapInteractionMode === 'select-location' ? 'primary' : 'ghost'}
          size="sm"
          onPress={handleUseMapSelection}
        >
          Use Map Selection
        </Button>
        <Button variant="ghost" size="sm" onPress={handleCopy}>
          Copy
        </Button>
        <Button variant="ghost" size="sm" onPress={handlePaste}>
          Paste
        </Button>
      </div>

      {lastAppliedCoordinate && (
        <Paragraph size="xs" color="muted" style={{ margin: 0 }}>
          Applied: {formatNumber(lastAppliedCoordinate.latitude)},{' '}
          {formatNumber(lastAppliedCoordinate.longitude)}
        </Paragraph>
      )}
    </div>
  );
};
