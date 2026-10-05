// Starter routines seeded on first launch (values in lbs). IDs are regenerated when seeded.
const ex = (id, name, muscleGroup) => ({ id, name, muscleGroup });
const sets = (w, r, n = 3) => Array.from({ length: n }, () => ({ weight: w, reps: r, completed: false }));

export const defaultTemplates = [
  {
    name: 'Push',
    exercises: [
      { exercise: ex('ex-bench-press-barbell', 'Bench Press (Barbell)', 'Chest'), sets: sets(115, 8), restTime: 120 },
      { exercise: ex('ex-barbell-incline-bench-press', 'Barbell Incline Bench Press', 'Chest'), sets: sets(95, 8), restTime: 90 },
      { exercise: ex('ex-overhead-press-barbell', 'Overhead Press (Barbell)', 'Shoulders'), sets: sets(65, 8), restTime: 90 },
      { exercise: ex('ex-lateral-raise-dumbbell', 'Lateral Raise (Dumbbell)', 'Shoulders'), sets: sets(15, 12), restTime: 60 },
      { exercise: ex('ex-tricep-pushdown-cable', 'Tricep Pushdown (Cable)', 'Triceps'), sets: sets(40, 12), restTime: 60 },
    ],
  },
  {
    name: 'Pull',
    exercises: [
      { exercise: ex('ex-deadlift-barbell', 'Deadlift (Barbell)', 'Back'), sets: sets(185, 5), restTime: 180 },
      { exercise: ex('ex-pull-up', 'Pull Up', 'Back'), sets: sets(0, 8), restTime: 90 },
      { exercise: ex('ex-seated-row-cable', 'Seated Row (Cable)', 'Back'), sets: sets(100, 10), restTime: 90 },
      { exercise: ex('ex-face-pull-cable', 'Face Pull (Cable)', 'Shoulders'), sets: sets(30, 15), restTime: 60 },
      { exercise: ex('ex-bicep-curl-dumbbell', 'Bicep Curl (Dumbbell)', 'Biceps'), sets: sets(25, 12), restTime: 60 },
    ],
  },
  {
    name: 'Legs',
    exercises: [
      { exercise: ex('ex-squat-barbell', 'Squat (Barbell)', 'Quadriceps'), sets: sets(155, 6), restTime: 180 },
      { exercise: ex('ex-romanian-deadlift-barbell', 'Romanian Deadlift (Barbell)', 'Hamstrings'), sets: sets(135, 8), restTime: 120 },
      { exercise: ex('ex-leg-press', 'Leg Press', 'Quadriceps'), sets: sets(230, 10), restTime: 90 },
      { exercise: ex('ex-leg-curl', 'Leg Curl', 'Hamstrings'), sets: sets(70, 12), restTime: 60 },
      { exercise: ex('ex-calf-raise', 'Calf Raise', 'Calves'), sets: sets(90, 15), restTime: 60 },
    ],
  },
];
