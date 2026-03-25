import SwiftUI

struct SettingsToggleRows<Intent: Hashable>: View {
    let descriptors: [SettingsToggleDescriptor<Intent>]
    let onChange: (Intent, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(descriptors) { descriptor in
                ViewThatFits(in: .horizontal) {
                    toggleRow(descriptor)
                    toggleColumn(descriptor)
                }
            }
        }
    }

    private func toggleRow(_ descriptor: SettingsToggleDescriptor<Intent>) -> some View {
        HStack(spacing: 12) {
            Text(LocalizedStringKey(descriptor.titleKey))
                .font(.body)
            Spacer(minLength: 0)
            toggleControl(descriptor)
        }
    }

    private func toggleColumn(_ descriptor: SettingsToggleDescriptor<Intent>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocalizedStringKey(descriptor.titleKey))
                .font(.body)
            toggleControl(descriptor)
        }
    }

    private func toggleControl(_ descriptor: SettingsToggleDescriptor<Intent>) -> some View {
        Toggle(
            "",
            isOn: Binding(
                get: { descriptor.isOn },
                set: { onChange(descriptor.intent, $0) }
            )
        )
        .labelsHidden()
        .toggleStyle(.switch)
        .disabled(!descriptor.isEnabled)
        .fixedSize()
    }
}

struct SettingsPickerRow<Value: Hashable>: View {
    let descriptor: SettingsPickerDescriptor<Value>
    let onSelect: (Value) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            pickerRow
            pickerColumn
        }
    }

    private var pickerRow: some View {
        HStack(spacing: 12) {
            Text(LocalizedStringKey(descriptor.titleKey))
                .font(.body)
            Spacer(minLength: 0)
            pickerControl
        }
    }

    private var pickerColumn: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(LocalizedStringKey(descriptor.titleKey))
                .font(.body)
            pickerControl
        }
    }

    private var pickerControl: some View {
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
        .labelsHidden()
        .frame(minWidth: LayoutRules.settingsPickerMinWidth, alignment: .trailing)
    }
}
