const express = require('express');
const supabase = require('../utils/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Create a ride request
router.post('/request', authenticateToken, async (req, res) => {
  try {
    const {
      pickupLatitude,
      pickupLongitude,
      pickupAddress,
      destinationLatitude,
      destinationLongitude,
      destinationAddress,
      rideType
    } = req.body;

    const userId = req.user.id;

    if (req.user.user_type !== 'rider') {
      return res.status(403).json({ error: 'Only riders can request rides' });
    }

    // Calculate estimated fare (simple calculation)
    const distance = calculateDistance(
      pickupLatitude,
      pickupLongitude,
      destinationLatitude,
      destinationLongitude
    );
    const baseFare = 1000; // Base fare 
    const perKmRate = 2500; // Rate per km 
    const estimatedFare = Math.round(baseFare + (distance * perKmRate));

    const { data: ride, error } = await supabase
      .from('rides')
      .insert({
        rider_id: userId,
        pickup_latitude: pickupLatitude,
        pickup_longitude: pickupLongitude,
        pickup_address: pickupAddress,
        destination_latitude: destinationLatitude,
        destination_longitude: destinationLongitude,
        destination_address: destinationAddress,
        ride_type: rideType || 'standard',
        status: 'requested',
        estimated_fare: estimatedFare,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Ride requested successfully',
      ride
    });
  } catch (error) {
    console.error('Ride request error:', error);
    res.status(500).json({ error: 'Failed to create ride request' });
  }
});

// Get available rides for drivers
router.get('/available', authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can view available rides' });
    }

    const { data: rides, error } = await supabase
      .from('rides')
      .select(`
        *,
        users:rider_id (
          first_name,
          last_name,
          phone_number
        )
      `)
      .eq('status', 'requested')
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.json({ rides });
  } catch (error) {
    console.error('Get available rides error:', error);
    res.status(500).json({ error: 'Failed to fetch available rides' });
  }
});

// Accept a ride (driver)
router.post('/:rideId/accept', authenticateToken, async (req, res) => {
  try {
    const { rideId } = req.params;
    const driverId = req.user.id;

    if (req.user.user_type !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can accept rides' });
    }

    // Check if ride is still available
    const { data: ride, error: fetchError } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .eq('status', 'requested')
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ error: 'Ride not available' });
    }

    // Accept the ride
    const { data: updatedRide, error } = await supabase
      .from('rides')
      .update({
        driver_id: driverId,
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', rideId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Ride accepted successfully',
      ride: updatedRide
    });
  } catch (error) {
    console.error('Accept ride error:', error);
    res.status(500).json({ error: 'Failed to accept ride' });
  }
});

// // Update ride status
// router.put('/:rideId/status', authenticateToken, async (req, res) => {
//   try {
//     const { rideId } = req.params;
//     const { status } = req.body;
//     const userId = req.user.id;

//     const validStatuses = ['picked_up', 'in_progress', 'completed', 'cancelled'];
//     if (!validStatuses.includes(status)) {
//       return res.status(400).json({ error: 'Invalid status' });
//     }

//     // Get ride to check permissions
//     const { data: ride, error: fetchError } = await supabase
//       .from('rides')
//       .select('*')
//       .eq('id', rideId)
//       .single();

//     if (fetchError || !ride) {
//       return res.status(404).json({ error: 'Ride not found' });
//     }

//     // Check permissions
//     if (req.user.user_type === 'driver' && ride.driver_id !== userId) {
//       return res.status(403).json({ error: 'Not authorized to update this ride' });
//     }
//     if (req.user.user_type === 'rider' && ride.rider_id !== userId) {
//       return res.status(403).json({ error: 'Not authorized to update this ride' });
//     }

//     const updateData = { status };

//     // Add timestamps based on status
//     if (status === 'picked_up') {
//       updateData.picked_up_at = new Date().toISOString();
//     } else if (status === 'completed') {
//       updateData.completed_at = new Date().toISOString();
//     } else if (status === 'cancelled') {
//       updateData.cancelled_at = new Date().toISOString();
//     }

//     const { data: updatedRide, error } = await supabase
//       .from('rides')
//       .update(updateData)
//       .eq('id', rideId)
//       .select()
//       .single();

//     if (error) throw error;

//     res.json({
//       message: 'Ride status updated successfully',
//       ride: updatedRide
//     });
//   } catch (error) {
//     console.error('Update ride status error:', error);
//     res.status(500).json({ error: 'Failed to update ride status' });
//   }
// });

// Update ride status
router.put('/:rideId/status', authenticateToken, async (req, res) => {
  try {
    const { rideId } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Updated valid statuses to include payment step
    const validStatuses = ['picked_up', 'in_progress', 'completed', 'awaiting_payment', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Get ride to check permissions
    const { data: ride, error: fetchError } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single();

    if (fetchError || !ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check permissions
    if (req.user.user_type === 'driver' && ride.driver_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this ride' });
    }
    if (req.user.user_type === 'rider' && ride.rider_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this ride' });
    }

    const updateData = { status };
    
    // Add timestamps based on status
    if (status === 'picked_up') {
      updateData.picked_up_at = new Date().toISOString();
    } else if (status === 'in_progress') {
      // REMOVED: updateData.started_at = new Date().toISOString();
      // You can use picked_up_at as the start time or add a new column if needed
    } else if (status === 'completed') {
      // When driver marks as completed, set to awaiting_payment instead
      if (req.user.user_type === 'driver') {
        updateData.status = 'awaiting_payment';
        updateData.completed_at = new Date().toISOString();
      } else {
        updateData.completed_at = new Date().toISOString();
      }
    } else if (status === 'cancelled') {
      updateData.cancelled_at = new Date().toISOString();
    }

    const { data: updatedRide, error } = await supabase
      .from('rides')
      .update(updateData)
      .eq('id', rideId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      message: 'Ride status updated successfully',
      ride: updatedRide
    });
  } catch (error) {
    console.error('Update ride status error:', error);
    res.status(500).json({ error: 'Failed to update ride status' });
  }
});

// Get user's rides
router.get('/my-rides', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let query = supabase.from('rides').select(`
      *,
      rider:rider_id (
        first_name,
        last_name,
        phone_number
      ),
      driver:driver_id (
        first_name,
        last_name,
        phone_number
      )
    `);

    if (req.user.user_type === 'rider') {
      query = query.eq('rider_id', userId);
    } else {
      query = query.eq('driver_id', userId);
    }

    const { data: rides, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ rides });
  } catch (error) {
    console.error('Get user rides error:', error);
    res.status(500).json({ error: 'Failed to fetch rides' });
  }
});

// Rider cancels ride (only if not accepted by driver)
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const userId = req.user.id;
    const { reason } = req.body;

    // Fetch the ride details
    const { data: ride, error } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single();

    if (error || !ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if current user is the rider
    if (ride.rider_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to cancel this ride' });
    }

    // Business Rule: Rider can't cancel if driver has already accepted
    if (['accepted', 'picked_up', 'in_progress', 'completed'].includes(ride.status)) {
      return res.status(400).json({ 
        error: "Cannot cancel ride after driver has accepted. Please contact the driver." 
      });
    }

    // Check if ride is already cancelled
    if (['cancelled', 'declined'].includes(ride.status)) {
      return res.status(400).json({ error: 'Ride is already cancelled' });
    }

    // Cancel the ride
    const { data: updatedRide, error: updateError } = await supabase
      .from('rides')
      .update({
        status: 'cancelled',
        cancelled_by: 'rider',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || 'Cancelled by rider'
      })
      .eq('id', rideId)
      .select()
      .single();

    if (updateError) {
      console.error('Cancel ride error:', updateError);
      return res.status(500).json({ error: 'Failed to cancel ride' });
    }

    console.log(`Ride ${rideId} cancelled by rider ${userId}`);

    res.json({ 
      message: 'Ride cancelled successfully', 
      ride: updatedRide 
    });

  } catch (error) {
    console.error('Rider cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
});

// Driver declines ride request
router.post('/:id/decline', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const driverId = req.user.id;
    const { reason } = req.body;

    // Fetch the ride details
    const { data: ride, error } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single();

    if (error || !ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if current user is a driver
    if (req.user.user_type !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can decline rides' });
    }

    // Check if ride is in a declinable state
    if (['completed', 'cancelled', 'declined'].includes(ride.status)) {
      return res.status(400).json({ error: 'Cannot decline this ride' });
    }

    // For requested rides, any driver can decline
    // For accepted rides, only the assigned driver can decline
    if (ride.status === 'accepted' && ride.driver_id !== driverId) {
      return res.status(403).json({ error: 'Not authorized to decline this ride' });
    }

    // Decline the ride
    const { data: updatedRide, error: updateError } = await supabase
      .from('rides')
      .update({
        status: 'declined',
        cancelled_by: 'driver',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || 'Declined by driver',
        driver_id: ride.status === 'requested' ? null : ride.driver_id // Keep driver if already assigned
      })
      .eq('id', rideId)
      .select()
      .single();

    if (updateError) {
      console.error('Decline ride error:', updateError);
      return res.status(500).json({ error: 'Failed to decline ride' });
    }

    console.log(`Ride ${rideId} declined by driver ${driverId}`);

    res.json({ 
      message: 'Ride declined successfully', 
      ride: updatedRide 
    });

  } catch (error) {
    console.error('Driver decline error:', error);
    res.status(500).json({ error: 'Failed to decline ride' });
  }
});

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

// Submit rating and review
router.post('/:id/rate', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const { rating, review } = req.body;
    const ratedBy = req.user.id;

    // Validate rating
    if (rating !== null && (rating < 0 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 0 and 5' });
    }

    // Get ride details
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .eq('status', 'completed')
      .single();

    if (rideError || !ride) {
      return res.status(404).json({ error: 'Completed ride not found' });
    }

    // Determine who is being rated
    let ratedUser;
    if (ride.rider_id === ratedBy) {
      // Rider is rating the driver
      ratedUser = ride.driver_id;
    } else if (ride.driver_id === ratedBy) {
      // Driver is rating the rider
      ratedUser = ride.rider_id;
    } else {
      return res.status(403).json({ error: 'Not authorized to rate this ride' });
    }

    if (!ratedUser) {
      return res.status(400).json({ error: 'Cannot determine user to rate' });
    }

    // Insert or update rating
    const { data: existingRating } = await supabase
      .from('ratings')
      .select('id')
      .eq('ride_id', rideId)
      .eq('rated_by', ratedBy)
      .single();

    let ratingData;
    if (existingRating) {
      // Update existing rating
      const { data, error } = await supabase
        .from('ratings')
        .update({
          rating: rating,
          review: review || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingRating.id)
        .select()
        .single();
      
      if (error) throw error;
      ratingData = data;
    } else {
      // Create new rating
      const { data, error } = await supabase
        .from('ratings')
        .insert({
          ride_id: rideId,
          rating: rating,
          review: review || null,
          rated_by: ratedBy,
          rated_user: ratedUser
        })
        .select()
        .single();
      
      if (error) throw error;
      ratingData = data;
    }

    // Update user's average rating
    await updateUserAverageRating(ratedUser);

    res.json({ 
      message: 'Rating submitted successfully', 
      rating: ratingData 
    });

  } catch (error) {
    console.error('Submit rating error:', error);
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Helper function to update user's average rating
async function updateUserAverageRating(userId) {
  try {
    const { data: ratings } = await supabase
      .from('ratings')
      .select('rating')
      .eq('rated_user', userId)
      .not('rating', 'is', null);

    if (ratings && ratings.length > 0) {
      const totalRating = ratings.reduce((sum, r) => sum + r.rating, 0);
      const averageRating = totalRating / ratings.length;

      await supabase
        .from('users')
        .update({
          average_rating: parseFloat(averageRating.toFixed(2)),
          total_ratings: ratings.length
        })
        .eq('id', userId);
    }
  } catch (error) {
    console.error('Error updating average rating:', error);
  }
}

// Get ratings for a ride
router.get('/:id/ratings', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;

    const { data: ratings, error } = await supabase
      .from('ratings')
      .select(`
        *,
        rated_by:rated_by(first_name, last_name),
        rated_user:rated_user(first_name, last_name)
      `)
      .eq('ride_id', rideId);

    if (error) throw error;

    res.json({ ratings });
  } catch (error) {
    console.error('Get ratings error:', error);
    res.status(500).json({ error: 'Failed to get ratings' });
  }
});



module.exports = router;
