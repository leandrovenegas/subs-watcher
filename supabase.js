require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[supabase] SUPABASE_URL and SUPABASE_KEY are required in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: require('ws') }
});

/**
 * Get pipeline settings (auto_mode + template)
 */
async function getSettings() {
  const { data, error } = await supabase
    .from('subs_pipeline_settings')
    .select('*')
    .limit(1)
    .single();

  if (error) throw new Error(`Failed to get settings: ${error.message}`);
  return data;
}

/**
 * Update auto_mode flag
 */
async function updateAutoMode(autoMode) {
  // Get the current settings id first
  const settings = await getSettings();

  const { data, error } = await supabase
    .from('subs_pipeline_settings')
    .update({ auto_mode: autoMode })
    .eq('id', settings.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update auto_mode: ${error.message}`);
  return data;
}

/**
 * Update subtitle template (jsonb)
 */
async function updateTemplate(template) {
  const settings = await getSettings();

  const { data, error } = await supabase
    .from('subs_pipeline_settings')
    .update({ template })
    .eq('id', settings.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update template: ${error.message}`);
  return data;
}

/**
 * Create a new queue entry for a detected video
 */
async function createQueueEntry(filename) {
  const { data, error } = await supabase
    .from('subs_pipeline_queue')
    .insert({ filename, status: 'pendiente' })
    .select()
    .single();

  if (error) throw new Error(`Failed to create queue entry: ${error.message}`);
  return data;
}

/**
 * Update a queue entry (status, output_path, etc.)
 */
async function updateQueueEntry(id, updates) {
  const { data, error } = await supabase
    .from('subs_pipeline_queue')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update queue entry ${id}: ${error.message}`);
  return data;
}

/**
 * Get all pending queue entries (ordered oldest first)
 */
async function getPendingEntries() {
  const { data, error } = await supabase
    .from('subs_pipeline_queue')
    .select('*')
    .eq('status', 'pendiente')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to get pending entries: ${error.message}`);
  return data || [];
}

/**
 * Get all queue entries (for the web UI, newest first)
 */
async function getQueueEntries() {
  const { data, error } = await supabase
    .from('subs_pipeline_queue')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw new Error(`Failed to get queue entries: ${error.message}`);
  return data || [];
}

module.exports = {
  supabase,
  getSettings,
  updateAutoMode,
  updateTemplate,
  createQueueEntry,
  updateQueueEntry,
  getPendingEntries,
  getQueueEntries
};
