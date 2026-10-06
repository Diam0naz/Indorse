/**
 * components/scout-photo-strip.tsx — the pixels behind a scout log row
 *
 * The log records how many shots a capture had; this shows them. A tap on
 * a thumbnail opens the photo full-screen — the evidence the AI diagnosed
 * is the point of the row, so it has to be readable, not counted. The
 * strip survives anchoring (photoUris is deliberately kept when a row
 * moves on-chain), and rows without persisted pixels render nothing
 * rather than a broken placeholder.
 */

import { useState } from 'react'
import { Image, Modal, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/components/theme-provider'
import { createStyles, fontSizes, radii, spacing, type Colors } from '@/constants/theme'
import { useT } from '@/lib/i18n'

interface ScoutPhotoStripProps {
  /** Evidence file URIs captured with the row — may be empty. */
  uris: string[]
}

export function ScoutPhotoStrip({ uris }: ScoutPhotoStripProps) {
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const t = useT()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState<number | null>(null)

  const photos = uris.filter((uri) => uri.length > 0)
  if (photos.length === 0) return null

  return (
    <View style={styles.strip}>
      {photos.map((uri, i) => (
        <Pressable
          key={`${uri}-${i}`}
          style={styles.thumb}
          onPress={() => setOpen(i)}
          accessibilityRole="button"
          accessibilityLabel={t('scout.viewPhoto', { n: i + 1, total: photos.length })}
        >
          <Image source={{ uri }} style={styles.thumbImg} resizeMode="cover" />
        </Pressable>
      ))}

      {/* Mounted only while open — this renderer shows a modal's contents
          when it mounts visible (the app's other modals are mounted the
          same way), and an idle viewer has no business lingering in the
          row's tree. */}
      {open !== null ? (
        <Modal visible animationType="fade" onRequestClose={() => setOpen(null)}>
          <View
            style={[styles.viewer, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]}
          >
            <View style={styles.viewerBar}>
              <Text style={styles.viewerCount}>{`${open + 1} / ${photos.length}`}</Text>
              <Pressable
                style={styles.closeBtn}
                onPress={() => setOpen(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('scout.photoClose')}
              >
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
            <Image source={{ uri: photos[open] }} style={styles.full} resizeMode="contain" />
          </View>
        </Modal>
      ) : null}
    </View>
  )
}

const makeStyles = (colors: Colors) =>
  createStyles({
    strip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    thumb: {
      width: 64,
      height: 64,
      borderRadius: radii.sm,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    thumbImg: {
      width: '100%',
      height: '100%',
    },
    viewer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    viewerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      minHeight: 44,
    },
    viewerCount: {
      fontFamily: 'monospace',
      fontSize: fontSizes.sm,
      color: colors.textDim,
      letterSpacing: 1,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textPrimary,
      fontSize: fontSizes.xl,
      lineHeight: 20,
    },
    full: {
      flex: 1,
      width: '100%',
    },
  })
