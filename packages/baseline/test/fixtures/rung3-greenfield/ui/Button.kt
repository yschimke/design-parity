package ui

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
fun PrimaryButton(label: String, onClick: () -> Unit) {
    Button(onClick = onClick) { Text(label) }
}

@Composable
fun SecondaryButton(label: String, onClick: () -> Unit) {
    Button(onClick = onClick) { Text(label) }
}

// not a component
private fun helper(): Int = 42
