/**
 * @fileoverview Template HTML data for predefined invoice templates.
 *
 * This file contains all HTML templates used by the block factory.
 * Each template is identified by a numeric key (1, 2, 3, etc.).
 *
 * To add a new template:
 * 1. Add a new key-value pair to TEMPLATE_HTML below
 * 2. No other code changes needed — the factory dispatcher handles it automatically
 *
 * Usage: window.FlowCanvas.TEMPLATE_HTML[n] returns the HTML string for template n
 */

window.FlowCanvas = window.FlowCanvas || {};

window.FlowCanvas.TEMPLATE_HTML = {
  1: `

   <div class="row-item cs-page-header" id="row_header_d1" data-cs-page-region="header" style="padding: 0px; min-height: 90px; border: 0px; background: linear-gradient(90deg, #f97316 0%, #f97316 100%); display: flex; align-items: center;">
      <div class="col-item" style="flex: 1 1 0px; max-width: 100%; padding: 20px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Company Header" id="block_header_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_header_d1" placeholder="" style="font-size: 24px; font-weight: bold; color: #ffffff; margin: 0;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="width: 45px; height: 45px; background: #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #f97316; font-weight: bold; font-size: 20px;">F</div>
              <div>
                <div style="color: #ffffff; font-size: 20px; font-weight: bold;">FLEX CORP</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="body-main-content" style="flex: 1 1 0%; display: flex; flex-direction: column; gap: 0px; padding: 25px;">

      <!-- Invoice Title -->
      <div class="row-item" id="row_title_d1" style="margin-bottom: 20px; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Title" id="block_title_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_title_d1" placeholder="" style="font-size: 28px; font-weight: bold; color: #f97316; margin: 0;">INVOICE</div>
          </div>
        </div>
      </div>

      <!-- Invoice Details Section -->
      <div class="row-item invoice-row invoice-row--intro" id="row_intro_d1" style="margin-bottom: 25px; min-height: 0px; gap: 20px;">
        <!-- Invoice To -->
        <div class="col-item" style="flex: 0 0 48%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Bill To" id="block_bill_to_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_bill_to_d1" placeholder="" style="font-size: 13px; color: #333;">
              <div style="font-weight: bold; color: #f97316; margin-bottom: 8px; font-size: 11px; text-transform: uppercase;">Bill To:</div>
              <div style="font-weight: bold; font-size: 14px; color: #333;">{{customer_name}}</div>
              <div style="color: #666; font-size: 12px;">{{address_line1}}</div>
              <div style="color: #666; font-size: 12px;">{{address_line2}}</div>
              <div style="color: #666; font-size: 12px;">{{city}}, {{state}} {{zip_code}}</div>
            </div>
          </div>
        </div>

        <!-- Invoice Meta Info -->
        <div class="col-item" style="flex: 0 0 48%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Details" id="block_details_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #fff8f0; padding: 15px; border-left: 4px solid #f97316; border-radius: 2px;">
            <div class="edit_me resize" id="dynamic_details_d1" placeholder="" style="font-size: 12px; color: #333; margin: 0;">
              <div style="display: grid; grid-template-columns: 80px 1fr; gap: 8px; margin-bottom: 8px;">
                <div style="font-weight: bold; color: #333;">Invoice #:</div>
                <div>{{invoice_number}}</div>
                <div style="font-weight: bold; color: #333;">Date:</div>
                <div>{{Invoice_Date}}</div>
                <div style="font-weight: bold; color: #333;">Due Date:</div>
                <div>{{due_date}}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div class="row-item invoice-row invoice-row--items" id="row_items_d1" style="margin-bottom: 25px; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Items Table" id="block_items_d1" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me fr-element fr-view resize" id="dynamic_items_d1" placeholder="" style="font-size: 12px; width: 100%; padding: 0px; margin: 0px; color: #333; overflow: visible;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f97316; color: white;">
                    <th style="padding: 10px 12px; text-align: left; font-weight: bold; border: 0;">Item Description</th>
                    <th style="padding: 10px 12px; text-align: center; font-weight: bold; border: 0; width: 70px;">Qty</th>
                    <th style="padding: 10px 12px; text-align: right; font-weight: bold; border: 0; width: 90px;">Unit Price</th>
                    <th style="padding: 10px 12px; text-align: right; font-weight: bold; border: 0; width: 90px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #fafafa;">
                    <td style="padding: 10px 12px; border: 0;">Professional Design Services</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$600.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$600.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #ffffff;">
                    <td style="padding: 10px 12px; border: 0;">Web Development (40 hours)</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">40</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$75.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$3,000.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #fafafa;">
                    <td style="padding: 10px 12px; border: 0;">UI/UX Testing & Revisions</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">2</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$250.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$500.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #ffffff;">
                    <td style="padding: 10px 12px; border: 0;">Content Writing (20 pages)</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">20</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$50.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$1,000.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #fafafa;">
                    <td style="padding: 10px 12px; border: 0;">SEO Optimization Services</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$400.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$400.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0; background: #ffffff;">
                    <td style="padding: 10px 12px; border: 0;">Project Management & Support</td>
                    <td style="padding: 10px 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$300.00</td>
                    <td style="padding: 10px 12px; text-align: right; border: 0;">$300.00</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Section -->
      <div class="row-item invoice-row invoice-row--summary" id="row_summary_d1" style="margin-bottom: 25px; min-height: 0px; gap: 20px;">
        <!-- Notes -->
        <div class="col-item" style="flex: 1 1 55%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Notes" id="block_notes_d1" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_notes_d1" placeholder="" style="font-size: 12px; color: #333;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #333; margin-bottom: 8px;">Terms & Conditions:</div>
                <div style="font-size: 11px; line-height: 1.6; color: #666;">
                  Payment is due within 30 days of invoice date. Please reference the invoice number with your payment. Late payments will incur 1.5% monthly interest charges.
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Totals -->
        <div class="col-item" style="flex: 0 0 45%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Totals" id="block_totals_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #fff8f0; padding: 15px; border: 1px solid #f97316; border-radius: 2px;">
            <div class="edit_me resize" id="dynamic_totals_d1" placeholder="" style="font-size: 12px; color: #333; margin: 0;">
              <div style="display: grid; grid-template-columns: 100px 90px; gap: 8px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #ffc699;">
                <div style="text-align: right; font-weight: 500;">Subtotal:</div>
                <div style="text-align: right;">$5,800.00</div>
                <div style="text-align: right; font-weight: 500;">Tax (0%):</div>
                <div style="text-align: right;">$0.00</div>
                <div style="text-align: right; font-weight: 500;">Shipping:</div>
                <div style="text-align: right;">$0.00</div>
              </div>
              <div style="display: grid; grid-template-columns: 100px 90px; gap: 8px; font-size: 14px;">
                <div style="text-align: right; font-weight: bold; color: #f97316;">TOTAL:</div>
                <div style="text-align: right; font-weight: bold; color: #f97316;">$5,800.00</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="row-item" id="row_footer_d1" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Footer" id="block_footer_d1" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_footer_d1" placeholder="" style="font-size: 10px; color: #999; text-align: center;">
              <div>Thank you for choosing FLEX CORP! | support@flexcorp.com | (555) 987-6543</div>
              <div style="margin-top: 5px;">© 2024 FLEX CORP. All Rights Reserved.</div>
            </div>
          </div>
        </div>
      </div>

    </div>
    `,
  2: `

  <div class="row-item cs-page-header" id="row_header_d2" data-cs-page-region="header" style="padding: 0px; min-height: 100px; border: 0px; display: flex;">
      <!-- Dark Left Side -->
      <div class="col-item" style="flex: 0 0 40%; max-width: 100%; background: #1a1a1a; padding: 20px; display: flex; align-items: center;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Company Info" id="block_header_left_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_header_left_d2" placeholder="" style="font-size: 22px; font-weight: bold; color: #ffffff; margin: 0;">
            <div style="color: #f97316; font-size: 26px; margin-bottom: 4px;">●●●</div>
            <div>MODERN</div>
            <div style="font-size: 12px; color: #f97316; font-weight: normal;">Creative Agency</div>
          </div>
        </div>
      </div>
      <!-- Orange Right Side -->
      <div class="col-item" style="flex: 0 0 60%; max-width: 100%; background: #f97316; padding: 20px; display: flex; align-items: center; justify-content: flex-end;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Header Title" id="block_header_right_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_header_right_d2" placeholder="" style="font-size: 32px; font-weight: bold; color: #ffffff; margin: 0; text-align: right;">INVOICE</div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="body-main-content" style="flex: 1 1 0%; display: flex; flex-direction: column; gap: 0px; padding: 30px;">

      <!-- Invoice Details -->
      <div class="row-item invoice-row invoice-row--intro" id="row_intro_d2" style="margin-bottom: 30px; min-height: 0px; gap: 30px;">
        <!-- Invoice To -->
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Bill To" id="block_bill_to_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_bill_to_d2" placeholder="" style="font-size: 13px; color: #333;">
              <div style="font-weight: bold; color: #f97316; margin-bottom: 10px; font-size: 12px; text-transform: uppercase;">Invoice To:</div>
              <div style="font-weight: bold; font-size: 16px; color: #1a1a1a; margin-bottom: 8px;">{{customer_name}}</div>
              <div style="color: #666; font-size: 12px; line-height: 1.6;">{{address_line1}}</div>
              <div style="color: #666; font-size: 12px;">{{address_line2}}</div>
              <div style="color: #666; font-size: 12px;">{{city}}, {{state}} {{zip_code}}</div>
              <div style="color: #666; font-size: 12px; margin-top: 8px;">{{customer_email}}</div>
            </div>
          </div>
        </div>

        <!-- Invoice Meta -->
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Meta" id="block_meta_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #f5f5f5; padding: 15px; border-radius: 4px;">
            <div class="edit_me resize" id="dynamic_meta_d2" placeholder="" style="font-size: 13px; color: #333; margin: 0;">
              <div style="display: grid; grid-template-columns: 100px 1fr; gap: 12px;">
                <div style="font-weight: bold; color: #333;">Invoice #:</div>
                <div>{{invoice_number}}</div>
                <div style="font-weight: bold; color: #333;">Date:</div>
                <div>{{Invoice_Date}}</div>
                <div style="font-weight: bold; color: #333;">Due Date:</div>
                <div>{{due_date}}</div>
                <div style="font-weight: bold; color: #333;">PO #:</div>
                <div>{{po_number}}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div class="row-item invoice-row invoice-row--items" id="row_items_d2" style="margin-bottom: 30px; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Items Table" id="block_items_d2" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me fr-element fr-view resize" id="dynamic_items_d2" placeholder="" style="font-size: 12px; width: 100%; padding: 0px; margin: 0px; color: #333; overflow: visible;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #1a1a1a; color: white;">
                    <th style="padding: 12px; text-align: left; font-weight: bold; border: 0;">Description</th>
                    <th style="padding: 12px; text-align: center; font-weight: bold; border: 0; width: 80px;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-weight: bold; border: 0; width: 100px;">Rate</th>
                    <th style="padding: 12px; text-align: right; font-weight: bold; border: 0; width: 100px;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Brand Identity Design</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$800.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$800.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Website Design & Development</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$2,500.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$2,500.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Social Media Graphics (20 assets)</td>
                    <td style="padding: 12px; text-align: center; border: 0;">20</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$75.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$1,500.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Marketing Collateral Design</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$600.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$600.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Video Production & Editing</td>
                    <td style="padding: 12px; text-align: center; border: 0;">3</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$400.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$1,200.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Copywriting & Content Strategy</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$350.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$350.00</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Section -->
      <div class="row-item invoice-row invoice-row--summary" id="row_summary_d2" style="margin-bottom: 30px; min-height: 0px; gap: 30px;">
        <!-- Notes -->
        <div class="col-item" style="flex: 1 1 50%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Notes" id="block_notes_d2" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_notes_d2" placeholder="" style="font-size: 12px; color: #333;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; color: #333; margin-bottom: 8px; font-size: 13px;">Special Notes:</div>
                <div style="font-size: 11px; line-height: 1.6; color: #666;">
                  Thank you for your project request! Upon project completion, all files and assets will be delivered in the agreed formats. Payment due upon invoice date as per our agreement.
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Payment & Totals -->
        <div class="col-item" style="flex: 0 0 50%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Payment Info" id="block_payment_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #f97316; padding: 20px; border-radius: 4px; color: white;">
            <div class="edit_me resize" id="dynamic_payment_d2" placeholder="" style="font-size: 12px; color: #ffffff; margin: 0;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px;">Payment Details:</div>
                <div style="font-size: 11px; line-height: 1.8;">
                  <div><strong>Bank:</strong> {{bank_name}}</div>
                  <div><strong>Account:</strong> {{bank_account}}</div>
                  <div><strong>Routing:</strong> {{routing_number}}</div>
                </div>
              </div>
              <div style="border-top: 1px solid rgba(255,255,255,0.3); padding-top: 15px;">
                <div style="display: grid; grid-template-columns: 120px 80px; gap: 10px; margin-bottom: 8px;">
                  <div style="text-align: right;">Subtotal:</div>
                  <div style="text-align: right;">$6,750.00</div>
                </div>
                <div style="display: grid; grid-template-columns: 120px 80px; gap: 10px; margin-bottom: 12px;">
                  <div style="text-align: right;">Tax:</div>
                  <div style="text-align: right;">$0.00</div>
                </div>
                <div style="display: grid; grid-template-columns: 120px 80px; gap: 10px; font-size: 14px; font-weight: bold;">
                  <div style="text-align: right;">Total Due:</div>
                  <div style="text-align: right;">$6,750.00</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="row-item" id="row_footer_d2" style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #f97316; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Footer" id="block_footer_d2" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_footer_d2" placeholder="" style="font-size: 11px; color: #999; text-align: center;">
              <div>Modern Creative Agency | hello@modernagency.com | 1-800-MODERN-1</div>
              <div style="margin-top: 6px;">© 2024 Modern Agency. All Rights Reserved. www.modernagency.com</div>
            </div>
          </div>
        </div>
      </div>

    </div>`,
  3: `

   <div class="row-item cs-page-header" id="row_header_d3" data-cs-page-region="header" style="padding: 0px; min-height: 100px; border: 0px; background: linear-gradient(135deg, #1a2a47 0%, #1a2a47 100%); display: flex; align-items: center;">
      <div class="col-item" style="flex: 1 1 0px; max-width: 100%; padding: 20px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Company Header" id="block_header_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_header_d3" placeholder="" style="font-size: 28px; font-weight: bold; color: #ffffff; margin: 0;">
            <div style="display: flex; align-items: center; gap: 15px;">
              <div style="width: 50px; height: 50px; background: #c41e3a; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 24px;">A</div>
              <div>
                <div style="color: #ffffff; font-size: 24px; font-weight: bold;">ACME Corp</div>
                <div style="color: #c41e3a; font-size: 12px; font-weight: normal;">Cloud & IT Solutions</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="body-main-content" style="flex: 1 1 0%; display: flex; flex-direction: column; gap: 0px; padding: 30px;">

      <!-- Invoice Title -->
      <div class="row-item" id="row_title_d3" style="margin-bottom: 20px; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Title" id="block_title_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_title_d3" placeholder="" style="font-size: 32px; font-weight: bold; color: #1a2a47; margin: 0;">INVOICE</div>
          </div>
        </div>
      </div>

      <!-- Invoice To / From Section -->
      <div class="row-item invoice-row invoice-row--intro" id="row_intro_d3" style="margin-bottom: 30px; min-height: 0px; gap: 30px;">
        <!-- Invoice To -->
        <div class="col-item" style="flex: 0 0 48%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice To" id="block_invoice_to_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_invoice_to_d3" placeholder="" style="font-size: 13px; color: #1a2a47;">
              <div style="font-weight: bold; color: #c41e3a; margin-bottom: 8px; font-size: 12px; text-transform: uppercase;">Bill To:</div>
              <div style="font-weight: bold; font-size: 15px;">{{customer_name}}</div>
              <div>{{address_line1}}</div>
              <div>{{address_line2}}</div>
              <div>{{city}}, {{state}} {{zip_code}}</div>
              <div style="margin-top: 8px;">{{customer_email}}</div>
            </div>
          </div>
        </div>

        <!-- Invoice Meta Info -->
        <div class="col-item" style="flex: 0 0 48%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Info" id="block_invoice_info_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #f5f5f5; padding: 15px; border-radius: 4px; border-left: 4px solid #c41e3a;">
            <div class="edit_me resize" id="dynamic_invoice_info_d3" placeholder="" style="font-size: 13px; color: #1a2a47; margin: 0;">
              <div style="display: grid; grid-template-columns: 100px 1fr; gap: 10px;">
                <div style="font-weight: bold; color: #1a2a47;">Invoice #:</div>
                <div>{{invoice_number}}</div>
                <div style="font-weight: bold; color: #1a2a47;">Date:</div>
                <div>{{Invoice_Date}}</div>
                <div style="font-weight: bold; color: #1a2a47;">Due Date:</div>
                <div>{{due_date}}</div>
                <div style="font-weight: bold; color: #1a2a47;">PO Number:</div>
                <div>{{po_number}}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <div class="row-item invoice-row invoice-row--items" id="row_items_d3" style="margin-bottom: 30px; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Items Table" id="block_items_d3" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me fr-element fr-view resize" id="dynamic_items_d3" placeholder="" style="font-size: 13px; width: 100%; padding: 0px; margin: 0px; color: #1a2a47; overflow: visible;">
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #1a2a47; color: white;">
                    <th style="padding: 12px; text-align: left; font-weight: bold; border: 0;">Item</th>
                    <th style="padding: 12px; text-align: center; font-weight: bold; border: 0; width: 80px;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-weight: bold; border: 0; width: 100px;">Unit Price</th>
                    <th style="padding: 12px; text-align: right; font-weight: bold; border: 0; width: 100px;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Cloud Hosting Setup</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$500.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$500.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Monthly Support & Maintenance</td>
                    <td style="padding: 12px; text-align: center; border: 0;">3</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$300.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$900.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Security Audit & Compliance</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$400.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$400.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">API Integration Development</td>
                    <td style="padding: 12px; text-align: center; border: 0;">2</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$250.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$500.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Database Optimization</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$350.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$350.00</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <td style="padding: 12px; border: 0;">Deployment & Go-Live Support</td>
                    <td style="padding: 12px; text-align: center; border: 0;">1</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$200.00</td>
                    <td style="padding: 12px; text-align: right; border: 0;">$200.00</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Section -->
      <div class="row-item invoice-row invoice-row--summary" id="row_summary_d3" style="margin-bottom: 30px; min-height: 0px; gap: 30px;">
        <!-- Notes Section -->
        <div class="col-item" style="flex: 1 1 60%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Notes & Payment" id="block_notes_d3" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_notes_d3" placeholder="" style="font-size: 13px; color: #1a2a47;">
              <div style="margin-bottom: 20px;">
                <div style="font-weight: bold; color: #1a2a47; margin-bottom: 8px; font-size: 14px;">Payment Methods:</div>
                <div style="background: #f5f5f5; padding: 12px; border-radius: 4px;">
                  <div style="margin-bottom: 8px;"><strong>Bank Transfer:</strong></div>
                  <div style="margin-left: 15px; font-size: 12px;">Account: {{bank_account}}</div>
                  <div style="margin-left: 15px; font-size: 12px;">Routing: {{routing_number}}</div>
                  <div style="margin-bottom: 8px; margin-top: 8px;"><strong>Credit Card:</strong> Accepted via PaymentGateway</div>
                </div>
              </div>

              <div style="margin-bottom: 20px;">
                <div style="font-weight: bold; color: #1a2a47; margin-bottom: 8px; font-size: 14px;">Terms & Conditions:</div>
                <div style="font-size: 12px; line-height: 1.6;">
                  Payment is due within 30 days of invoice date. Late payments subject to 1.5% monthly interest. Please reference invoice number in payment communication.
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Totals Section -->
        <div class="col-item" style="flex: 0 0 40%; max-width: 100%; min-height: 0px;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Totals" id="block_totals_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: #f5f5f5; padding: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(196, 30, 58, 0.1);">
            <div class="edit_me resize" id="dynamic_totals_d3" placeholder="" style="font-size: 13px; color: #1a2a47; margin: 0;">
              <div style="display: grid; grid-template-columns: 120px 80px; gap: 10px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #ddd;">
                <div style="text-align: right;">Subtotal:</div>
                <div style="text-align: right; font-weight: bold;">$2,850.00</div>
                <div style="text-align: right;">Tax (0%):</div>
                <div style="text-align: right; font-weight: bold;">$0.00</div>
                <div style="text-align: right;">Discount:</div>
                <div style="text-align: right; font-weight: bold;">$0.00</div>
              </div>
              <div style="display: grid; grid-template-columns: 120px 80px; gap: 10px; font-size: 16px;">
                <div style="text-align: right; font-weight: bold; color: #c41e3a;">Total Due:</div>
                <div style="text-align: right; font-weight: bold; color: #c41e3a;">$2,850.00</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Section -->
      <div class="row-item" id="row_footer_d3" style="margin-top: 30px; padding-top: 30px; border-top: 2px solid #1a2a47; min-height: 0px;">
        <div class="col-item" style="flex: 1 1 0px; max-width: 100%;">
          <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Footer" id="block_footer_d3" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
            <div class="edit_me resize" id="dynamic_footer_d3" placeholder="" style="font-size: 11px; color: #666; text-align: center;">
              <div>Thank you for your business! For questions, contact support@acmecorp.com | Phone: (555) 123-4567</div>
              <div style="margin-top: 8px;">© 2024 ACME Corp. All rights reserved.</div>
            </div>
          </div>
        </div>
      </div>

    </div>`,
  4: `

    <div class="row-item cs-page-header" id="row_header_d4" data-cs-page-region="header" style="padding: 30px 36px; border: 0px; background: #1a2649; display: flex; justify-content: space-between; align-items: flex-start; position: relative;">
      <div class="col-item" style="flex: 0 0 auto; max-width: 50%;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Company Logo & Info" id="block_logo_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_logo_d4" placeholder="" style="color: #ffffff;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
              <div style="width: 52px; height: 44px; background: #f5c100; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-weight: 900; color: #1a2649; font-size: 28px;">A</div>
              <div>
                <div style="font-size: 18px; font-weight: 800; color: #ffffff;">Salford &amp; Co.</div>
              </div>
            </div>
            <div style="font-size: 12px; color: #a0aec0; font-style: italic; margin-bottom: 8px;">Invoice To:</div>
            <div style="font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 2px;">{{client_name}}</div>
            <div style="font-size: 12px; color: #a0aec0;">{{client_role}}</div>
          </div>
        </div>
      </div>

      <div class="col-item" style="flex: 0 0 auto; max-width: 50%; text-align: right;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Invoice Meta" id="block_meta_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_meta_d4" placeholder="" style="color: #ffffff;">
            <div style="font-size: 52px; font-weight: 900; letter-spacing: 2px; color: #f5c100; line-height: 1; margin-bottom: 18px;">INVOICE</div>
            <div style="display: grid; grid-template-columns: auto auto; gap: 4px 24px; font-size: 13px;">
              <div style="color: #a0aec0;">Invoice No:</div>
              <div style="color: #ffffff; font-weight: 600; text-align: right;">{{invoice_number}}</div>
              <div style="color: #a0aec0;">Due Date:</div>
              <div style="color: #ffffff; font-weight: 600; text-align: right;">{{due_date}}</div>
              <div style="color: #a0aec0;">Invoice Date:</div>
              <div style="color: #ffffff; font-weight: 600; text-align: right;">{{invoice_date}}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Address Banner -->
    <div class="row-item" id="row_address_d4" style="background: #f5c100; padding: 13px 36px; display: flex; align-items: center; gap: 10px; position: relative;">
      <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Address" id="block_address_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none; flex: 1;">
        <div class="edit_me resize" id="dynamic_address_d4" placeholder="" style="color: #1a2649; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
          <span style="display: inline-block; width: 28px; height: 28px; background: #1a2649; border-radius: 50%; text-align: center; line-height: 28px; color: #f5c100; font-size: 12px; flex-shrink: 0;">📍</span>
          {{company_address}}
        </div>
      </div>
    </div>

    <!-- Contact + Payment Info -->
    <div class="row-item" id="row_info_d4" style="display: flex; padding: 28px 36px; gap: 40px; border-bottom: 1px solid #f0f0f0; min-height: 0px;">
      <div class="col-item" style="flex: 1; max-width: 100%; min-height: 0px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Contact Info" id="block_contact_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_contact_d4" placeholder="" style="font-size: 13px; color: #444;">
            <div style="margin-bottom: 6px;"><span style="color: #666; width: 60px; display: inline-block;">Phone:</span> {{phone}}</div>
            <div style="margin-bottom: 6px;"><span style="color: #666; width: 60px; display: inline-block;">Email:</span> {{email}}</div>
            <div><span style="color: #666; width: 60px; display: inline-block;">Address:</span> {{address}}</div>
          </div>
        </div>
      </div>

      <div class="col-item" style="flex: 1; max-width: 100%; min-height: 0px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Payment Method" id="block_payment_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_payment_d4" placeholder="" style="font-size: 13px; color: #444;">
            <div style="font-size: 13px; font-weight: 800; color: #1a2649; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">Payment Method</div>
            <div style="margin-bottom: 5px; display: flex; justify-content: space-between;"><span style="color: #666;">Account No:</span> <span style="font-weight: 500;">{{account_number}}</span></div>
            <div style="margin-bottom: 5px; display: flex; justify-content: space-between;"><span style="color: #666;">Account Name:</span> <span style="font-weight: 500;">{{account_name}}</span></div>
            <div style="display: flex; justify-content: space-between;"><span style="color: #666;">Branch:</span> <span style="font-weight: 500;">{{branch_name}}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <div class="row-item" id="row_items_d4" style="padding: 0 36px 24px; min-height: 0px;">
      <div class="col-item" style="flex: 1 1 0px; max-width: 100%; min-height: 0px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Items Table" id="block_items_d4" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me fr-element fr-view resize" id="dynamic_items_d4" placeholder="" style="font-size: 13px; width: 100%; padding: 0px; margin: 0px; color: #333; overflow: visible;">
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #1a2649; color: white;">
                  <th style="padding: 12px 16px; text-align: left; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 0;">Description</th>
                  <th style="padding: 12px 16px; text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 0; width: 100px;">Subtotal</th>
                  <th style="padding: 12px 16px; text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 0; width: 60px;">QTY</th>
                  <th style="padding: 12px 16px; text-align: right; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border: 0; width: 80px;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid #f0f0f0;">
                  <td style="padding: 13px 16px; border: 0;">Brand Consultation</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">$100</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">1</td>
                  <td style="padding: 13px 16px; text-align: right; border: 0; font-weight: 600;">$100.00</td>
                </tr>
                <tr style="border-bottom: 1px solid #f0f0f0; background: #f9fafb;">
                  <td style="padding: 13px 16px; border: 0;">Logo Design</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">$100</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">1</td>
                  <td style="padding: 13px 16px; text-align: right; border: 0; font-weight: 600;">$100.00</td>
                </tr>
                <tr style="border-bottom: 1px solid #f0f0f0;">
                  <td style="padding: 13px 16px; border: 0;">Website Design</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">$100</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">1</td>
                  <td style="padding: 13px 16px; text-align: right; border: 0; font-weight: 600;">$100.00</td>
                </tr>
                <tr style="border-bottom: 1px solid #f0f0f0; background: #f9fafb;">
                  <td style="padding: 13px 16px; border: 0;">Social Media Template</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">$100</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">1</td>
                  <td style="padding: 13px 16px; text-align: right; border: 0; font-weight: 600;">$100.00</td>
                </tr>
                <tr style="border-bottom: 1px solid #f0f0f0;">
                  <td style="padding: 13px 16px; border: 0;">Flyer</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">$50</td>
                  <td style="padding: 13px 16px; text-align: center; border: 0;">6</td>
                  <td style="padding: 13px 16px; text-align: right; border: 0; font-weight: 600;">$300.00</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer: Terms + Totals -->
    <div class="row-item" id="row_footer_d4" style="display: flex; padding: 16px 36px 28px; gap: 40px; align-items: flex-start; min-height: 0px;">
      <div class="col-item" style="flex: 1.2; max-width: 100%; min-height: 0px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Terms" id="block_terms_d4" style="width: 100%; max-width: 100%; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_terms_d4" placeholder="" style="font-size: 12px; color: #555; line-height: 1.6;">
            <div style="font-size: 13px; font-weight: 800; color: #1a2649; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Terms and Conditions</div>
            <div style="text-align: justify; margin-bottom: 20px;">Please send payment within 30 days of receiving this invoice. There will be a 10% interest charge per month on late invoice.</div>

            <div style="font-size: 13px; font-weight: 800; color: #1a2649; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;">Thank You For Your Business</div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px;">
              <div style="width: 22px; height: 22px; background: #1a2649; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #f5c100; font-size: 10px;">📞</div>
              <span>{{phone_footer}}</span>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px;">
              <div style="width: 22px; height: 22px; background: #1a2649; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #f5c100; font-size: 10px;">🌐</div>
              <span>{{website}}</span>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; font-size: 12px;">
              <div style="width: 22px; height: 22px; background: #1a2649; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: #f5c100; font-size: 10px;">📍</div>
              <span>{{address_footer}}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="col-item" style="flex: 0.8; max-width: 100%; min-height: 0px;">
        <div class="cs_block_s cs_dp_allow content-block cs-sales-editor drop_elem canvas-block" data="Textarea" custom-name="Totals" id="block_totals_d4" style="width: 100%; max-width: none; border: 0px; margin: 0px; background: transparent; box-shadow: none;">
          <div class="edit_me resize" id="dynamic_totals_d4" placeholder="" style="font-size: 13px; color: #555;">
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
              <span style="font-weight: 600; color: #333;">Sub-total:</span>
              <span>$700.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
              <span style="font-weight: 600; color: #333;">Discount:</span>
              <span>$0.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;">
              <span style="font-weight: 600; color: #333;">Tax (10%):</span>
              <span>$50.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; padding: 11px 14px; background: #1a2649; border-radius: 3px; margin-top: 4px;">
              <span style="color: #ffffff; font-size: 15px; font-weight: 800;">Total:</span>
              <span style="color: #ffffff; font-size: 15px; font-weight: 800;">$750.00</span>
            </div>

            <div style="text-align: right; margin-top: 28px;">
              <div style="border-top: 1.5px solid #444; width: 140px; margin-left: auto; margin-bottom: 6px;"></div>
              <div style="font-size: 13px; font-weight: 700; color: #333;">{{signature_name}}</div>
              <div style="font-size: 12px; color: #777;">{{signature_role}}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Footer Bar -->
    <div class="row-item" id="row_bottom_d4" style="background: #f5c100; height: 22px; position: relative; overflow: hidden; min-height: 0px;"></div>
    `,
};
