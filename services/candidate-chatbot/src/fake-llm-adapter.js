export class FakeLlmAdapter {
  constructor(overrides = {}) {
    this.overrides = overrides;
  }

  async evaluate(input) {
    const override = this.overrides[input.conversation.conversation_id];
    if (override !== undefined) {
      const overrideResult = typeof override === "function" ? override(input) : override;
      if (overrideResult !== undefined) {
        return overrideResult;
      }
    }

    switch (input.conversation.conversation_id) {
      case "conv-zakup-001":
        return {
          step_result: "needs_clarification",
          completed_step_ids: ["direct_china_suppliers", "china_platforms", "purchase_volume"],
          rejected_step_id: null,
          extracted_facts: {
            direct_china_suppliers: true,
            china_platforms: ["1688", "WeChat"],
            monthly_purchase_budget: "15-20 млн руб."
          },
          missing_information: ["product_categories", "quality_cases", "compensation_and_travel"],
          next_message: "Спасибо, опыт релевантный. Уточните, пожалуйста, с какими категориями товаров работали в последние 2-3 года и приходилось ли решать вопросы с браком или инспекциями до отгрузки?",
          confidence: 0.91,
          guard_flags: []
        };

      case "conv-cook-001":
        return {
          step_result: "reject",
          completed_step_ids: ["hot_shop_experience", "schedule_fit"],
          rejected_step_id: "medical_book",
          extracted_facts: {
            hot_shop_experience: true,
            schedule_fit: true,
            medical_book_refused: true
          },
          missing_information: [],
          next_message: "Иван, спасибо за ответы. Для этой позиции действующая медкнижка или готовность оформить ее до выхода обязательны, поэтому сейчас не сможем продолжить по вакансии. Удачи в поиске подходящей работы.",
          confidence: 0.92,
          guard_flags: []
        };

      case "conv-sales-001":
        return {
          step_result: "needs_clarification",
          completed_step_ids: ["crm_usage", "compensation_model"],
          rejected_step_id: null,
          extracted_facts: {
            crm_usage: true,
            compensation_model: "150 фикс + бонус"
          },
          missing_information: ["b2b_sales_experience", "industrial_or_complex_product", "long_cycle", "travel_fit"],
          next_message: "Анна, спасибо. Уточните, пожалуйста, это были именно B2B-продажи? Какой продукт продавали, какой обычно был цикл сделки и готовы ли вы к командировкам 1-2 раза в квартал?",
          confidence: 0.87,
          guard_flags: []
        };

      default:
        return {
          step_result: "manual_review",
          completed_step_ids: [],
          rejected_step_id: null,
          extracted_facts: {},
          missing_information: input.pendingSteps.map((step) => step.step_id),
          next_message: "",
          confidence: 0.1,
          guard_flags: ["fake_adapter_no_fixture"]
        };
    }
  }
}
