import type { StateCreator } from 'zustand'
import { mockCaptures } from '@/lib/mock-data'
import { cadenceLabel } from '@/lib/capture-status'
import type { Capture } from '@/types/capture'
import type { MockDataState } from './mock-data-store'

// The capture slice of the mock data store, split out of mock-data-store.ts to
// keep that file under the repo's file-size limit, the same way the KPI and
// report slices were. It is a zustand slice, not a separate store: nothing here
// reads another collection today, but a capture's cadence and its alert are the
// mock stand-in for the same Redash schedule the query slice describes, so they
// belong in the same state object.
//
// Community, unlike the KPI and report slices beside it: captures are a
// community surface (/captures), and the fixtures come from the pack
// directly rather than through the mock contribution seam.
export interface CaptureSlice {
  captures: Capture[]
  setCaptureExpectation: (captureId: string, seconds: number | null) => void
  setCaptureAlert: (captureId: string, armed: boolean) => void
}

export const createCaptureSlice: StateCreator<MockDataState, [], [], CaptureSlice> = (set) => ({
  captures: [...mockCaptures],

  setCaptureExpectation: (captureId, seconds) =>
    set((s) => ({
      captures: s.captures.map((capture) =>
        capture.id === captureId
          ? {
              ...capture,
              // The label is recomputed rather than stored twice, so the two
              // can never disagree, and cleared falls back to 'not scheduled'
              // because mock captures carry no Redash schedule to return to.
              cadence: seconds == null ? 'not scheduled' : cadenceLabel(seconds),
              cadenceSource: seconds == null ? 'none' : 'declared',
              expectedIntervalSeconds: seconds,
            }
          : capture
      ),
    })),

  setCaptureAlert: (captureId, armed) =>
    set((s) => ({
      captures: s.captures.map((capture) =>
        // A stand-in id, because mock mode has no Redash to answer with a real
        // one. Only its presence is ever read.
        capture.id === captureId ? { ...capture, alertId: armed ? 1 : null } : capture
      ),
    })),
})
