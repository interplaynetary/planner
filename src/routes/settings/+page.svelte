<script lang="ts">
  import BufferProfileEditor from '$lib/components/settings/BufferProfileEditor.svelte';
  import PartProfileAssignment from '$lib/components/settings/PartProfileAssignment.svelte';
  import { bufferProfileList, upsertBufferProfile, resourceSpecs } from '$lib/vf-stores.svelte';
</script>

<BufferProfileEditor profiles={bufferProfileList} onupsert={upsertBufferProfile} />
<PartProfileAssignment specs={resourceSpecs} profiles={bufferProfileList} />
