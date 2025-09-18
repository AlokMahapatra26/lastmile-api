const express = require('express');
const supabase = require('../utils/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();


router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, phoneNumber } = req.body;
    const userId = req.user.id;

    console.log('Update request:', { firstName, lastName, phoneNumber, userId });

    const { data: user, error } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        phone_number: phoneNumber,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    console.log('Supabase response:', { user, error });

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    if (!user) {
      console.error('No user returned from update');
      return res.status(404).json({ error: 'User not found or update failed' });
    }

    const { password_hash, ...userWithoutPassword } = user;
    
    console.log('Returning user:', userWithoutPassword);
    res.json({ message: 'Profile updated successfully', user: userWithoutPassword });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});


// Update driver location (for drivers only)
router.put('/location', authenticateToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.id;

    if (req.user.user_type !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can update location' });
    }

    const { error } = await supabase
      .from('users')
      .update({
        current_latitude: latitude,
        current_longitude: longitude,
        last_location_update: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) throw error;

    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Get all ratings for a specific user
router.get('/ratings/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Only allow users to view their own ratings or make it public
    if (req.user.id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view these ratings' });
    }

    const { data: ratings, error } = await supabase
      .from('ratings')
      .select(`
        *,
        rated_by:rated_by(first_name, last_name),
        rated_user:rated_user(first_name, last_name)
      `)
      .eq('rated_user', userId)
      .not('rating', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ ratings });
  } catch (error) {
    console.error('Get user ratings error:', error);
    res.status(500).json({ error: 'Failed to get user ratings' });
  }
});


module.exports = router;
