import SwiftUI

struct SettingsToggleRows<Intent: Hashable>: View {
    let descriptors: [SettingsToggleDescriptor<Intent>]
    let onChange: (Intent, Bool) -> Void

    var body: some View {
        ForEach(descriptors) { descriptor in
            Toggle(
                LocalizedStringKey(descriptor.titleKey),
                isOn: Binding(
                    get: { descriptor.isOn },
                    set: { onChange(descriptor.intent, $0) }
                )
            )
            .toggleStyle(.switch)
            .disabled(!descriptor.isEnabled)
        }
    }
}

struct SettingsPickerRow<Value: Hashable>: View {
    let descriptor: SettingsPickerDescriptor<Value>
    let onSelect: (Value) -> Void

    var body: some View {
        Picker(
            LocalizedStringKey(descriptor.titleKey),
            selection: Binding(
                get: { descriptor.selectedValue },
                set: { value in
                    onSelect(value)
                }
            )
        ) {
            ForEach(descriptor.options) { option in
                Text(option.title).tag(option.value)
            }
        }
        .pickerStyle(.menu)
        .disabled(!descriptor.isEnabled)
    }
}
