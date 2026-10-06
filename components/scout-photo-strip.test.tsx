/**
 * components/scout-photo-strip.test.tsx — viewing a capture's evidence
 *
 * Locks the promise the log makes: a row's shots are reachable, not just
 * counted. Thumbnails open the full-screen viewer, the counter tracks the
 * shown photo, and a row with no persisted pixels renders nothing.
 */

import { fireEvent, render, screen } from '@testing-library/react-native'
import { describe, expect, it, vi } from 'vitest'
import { ScoutPhotoStrip } from './scout-photo-strip'

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

describe('scout-photo-strip', () => {
  it('labels every thumbnail so the shots are individually reachable', async () => {
    await render(<ScoutPhotoStrip uris={['file:///evidence/a.jpg', 'file:///evidence/b.jpg']} />)
    expect(screen.getByLabelText('View photo 1 of 2')).toBeTruthy()
    expect(screen.getByLabelText('View photo 2 of 2')).toBeTruthy()
  })

  it('opens the full-screen viewer and closes it again', async () => {
    await render(<ScoutPhotoStrip uris={['file:///evidence/a.jpg', 'file:///evidence/b.jpg']} />)

    await fireEvent.press(screen.getByLabelText('View photo 2 of 2'))
    expect(screen.getByText('2 / 2')).toBeTruthy()
    expect(screen.getByLabelText('Close photo')).toBeTruthy()

    await fireEvent.press(screen.getByLabelText('Close photo'))
    expect(screen.queryByText('2 / 2')).toBeNull()
  })

  it('renders nothing when the row has no persisted pixels', async () => {
    const view = await render(<ScoutPhotoStrip uris={[]} />)
    expect(view.toJSON()).toBeNull()

    const blanks = await render(<ScoutPhotoStrip uris={['', '']} />)
    expect(blanks.toJSON()).toBeNull()
  })

  it('skips blank slots but keeps the real shot reachable', async () => {
    await render(<ScoutPhotoStrip uris={['', 'file:///evidence/only.jpg']} />)
    expect(screen.getByLabelText('View photo 1 of 1')).toBeTruthy()
    expect(screen.queryByLabelText('View photo 2 of 2')).toBeNull()
  })
})
