-- Enable RLS on personas table
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;

-- Allow reading all personas (since they represent public profiles)
CREATE POLICY "Anyone can view personas" ON personas
    FOR SELECT
    USING (true);

-- Only owners and admins can update their personas
CREATE POLICY "Users can update their own personas" ON personas
    FOR UPDATE
    USING (auth.uid() = owner_id);

-- Only owners and admins can delete their personas
CREATE POLICY "Users can delete their own personas" ON personas
    FOR DELETE
    USING (auth.uid() = owner_id);

-- Only authenticated users can create personas
CREATE POLICY "Authenticated users can create personas" ON personas
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated'); 