/**
 * "المرفقات" group — a titled card of attachment rows, rendered below the
 * lecture list on the section page. Renders nothing when there are no
 * attachments, so it costs nothing on nodes without any (the renderer seam).
 */
import { View } from 'react-native';

import type { Attachment } from '@/api/types';
import { Card, Divider, SectionTitle } from '@/components/ui';
import { AttachmentRow } from './AttachmentRow';

export function AttachmentList({
  attachments,
  title = 'المرفقات',
}: {
  attachments: Attachment[];
  title?: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <View>
      <SectionTitle title={title} />
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {attachments.map((attachment, index) => (
          <View key={attachment.id}>
            {index > 0 ? <Divider /> : null}
            <AttachmentRow attachment={attachment} />
          </View>
        ))}
      </Card>
    </View>
  );
}
